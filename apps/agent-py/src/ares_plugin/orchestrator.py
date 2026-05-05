"""ARES orchestrator — routing + sub-agent execution (LiteLLM + local tools)."""

from __future__ import annotations

import asyncio
import inspect
import json
import os
import re
from typing import Any, Awaitable, Callable

import litellm

from ares_plugin.config import get_settings
from ares_plugin.llm import ensure_api_keys_for_model, to_litellm_model
from ares_plugin.persistence import JsonlPersistence
from ares_plugin.sub_agents import SUB_AGENTS, SubAgentSpec
from ares_plugin.tools.assurance import dispatch_any_tool, openai_tools_definitions

ORCHESTRATOR_PROMPT = """You are ARES Orchestrator — Automated Resilience Evaluation System for Solana security intelligence.

## CRITICAL — Current Repository Path:
The user's repository is located at: {repo_root}
ALWAYS use this exact path when delegating tasks.

You do NOT use tools directly. Instead, you REASON about the user's request and DELEGATE to specialized sub-agents.

## Available Sub-Agents:
{agent_list}

## Your Workflow:
1. ANALYZE the user's request
2. DECIDE which sub-agent(s) to invoke
3. RESPOND with a JSON array of tasks in this exact format:

```json
[
  {{"agent": "agent_name", "task": "specific instructions for this agent"}}
]
```

## Rules:
- Always include "report_synthesizer" as the LAST agent when the user wants analysis or a report
- For general chat/questions, respond with just a "report_synthesizer" agent
- For full scans, invoke ALL relevant agents
"""


async def _maybe_call(cb: Callable[..., Any] | None, *args: Any) -> None:
    if not cb:
        return
    r = cb(*args)
    if inspect.isawaitable(r):
        await r


class AresOrchestrator:
    def __init__(self, repo_root: str, model: str | None = None) -> None:
        self.repo_root = os.path.abspath(repo_root)
        self.model = (
            model
            or os.environ.get("ASST_ORCHESTRATOR_MODEL")
            or get_settings().default_model
        )
        self._persist = JsonlPersistence(self.repo_root)
        self._init_done = False

    async def init(self) -> None:
        if not self._init_done:
            await self._persist.init()
            self._init_done = True

    async def get_recent_history(self, limit: int = 20) -> list[dict[str, Any]]:
        await self.init()
        rows = await self._persist.get_history(limit)
        return list(reversed(rows))

    def _orchestrator_prompt(self) -> str:
        agent_list = "\n".join(f"- **{n}**: {s.description}" for n, s in SUB_AGENTS.items())
        return ORCHESTRATOR_PROMPT.format(repo_root=self.repo_root, agent_list=agent_list)

    async def _route(self, user_input: str) -> list[dict[str, str]]:
        await self.init()
        hist = await self._persist.get_history(10)
        hist_msgs = [{"role": "assistant" if h["role"] == "agent" else h["role"], "content": h["content"]} for h in reversed(hist)]
        messages: list[dict[str, Any]] = (
            [{"role": "system", "content": self._orchestrator_prompt()}]
            + hist_msgs
            + [{"role": "user", "content": user_input}]
        )
        lm = to_litellm_model(self.model)
        ensure_api_keys_for_model(lm)
        resp = await litellm.acompletion(model=lm, messages=messages, temperature=0.1)
        text = str(resp.choices[0].message.content or "")
        m = re.search(r"\[[\s\S]*?\]", text)
        if not m:
            return [{"agent": "report_synthesizer", "task": user_input}]
        try:
            parsed = json.loads(m.group(0))
            if isinstance(parsed, list):
                return [t for t in parsed if isinstance(t, dict) and "agent" in t and "task" in t]
        except json.JSONDecodeError:
            pass
        return [{"agent": "report_synthesizer", "task": user_input}]

    async def _invoke_subagent(self, spec: SubAgentSpec, task: str, model_override: str | None) -> str:
        lm = to_litellm_model(model_override or spec.primary_model)
        ensure_api_keys_for_model(lm)
        defs = openai_tools_definitions()
        allowed = set(spec.tool_names)
        tools = [t for t in defs if t.get("function", {}).get("name") in allowed]
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": spec.system_prompt},
            {
                "role": "user",
                "content": f"Repository: {self.repo_root}\n\nTask:\n{task}",
            },
        ]
        for _ in range(18):
            resp = await litellm.acompletion(
                model=lm,
                messages=messages,
                tools=tools or None,
                temperature=0.2,
            )
            choice = resp.choices[0].message
            if choice.tool_calls:
                messages.append(
                    {
                        "role": "assistant",
                        "content": choice.content,
                        "tool_calls": [tc.model_dump() for tc in choice.tool_calls],
                    }
                )
                for tc in choice.tool_calls:
                    name = tc.function.name
                    try:
                        args = json.loads(tc.function.arguments or "{}")
                    except json.JSONDecodeError:
                        args = {}
                    if name in allowed:
                        out = await dispatch_any_tool(name, args)
                    else:
                        out = json.dumps({"error": f"tool {name} not enabled for this sub-agent"})
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tc.id,
                            "content": out[:120_000],
                        }
                    )
                continue
            return str(choice.content or "")

        return "[Error] sub-agent iteration budget exceeded"

    async def chat(
        self,
        prompt: str,
        on_status: Callable[[str], Awaitable[None] | None] | None = None,
    ) -> str:
        await self.init()
        await self._persist.add_history("user", prompt)
        await _maybe_call(on_status, "Orchestrator is reasoning...")
        routing = await self._route(prompt)
        if not routing:
            out = "I couldn't determine how to process that request."
            await self._persist.add_history("agent", out)
            return out

        results: list[dict[str, str]] = []
        independent = [t for t in routing if t["agent"] != "report_synthesizer"]
        synth = next((t for t in routing if t["agent"] == "report_synthesizer"), None)

        async def run_one(task: dict[str, str]) -> dict[str, str]:
            spec = SUB_AGENTS.get(task["agent"])
            if not spec:
                return {"agent": task["agent"], "output": f'[Error] unknown agent "{task["agent"]}"'}
            await _maybe_call(on_status, f"{spec.name} is analyzing...")
            out = await self._invoke_subagent(spec, str(task["task"]), self.model)
            return {"agent": task["agent"], "output": out}

        if independent:
            await _maybe_call(on_status, f"Running {len(independent)} agents in parallel...")
            settled = await asyncio.gather(*[run_one(t) for t in independent], return_exceptions=True)
            for item in settled:
                if isinstance(item, Exception):
                    results.append({"agent": "unknown", "output": f"[Error] {item}"})
                elif isinstance(item, dict):
                    results.append(item)

        if synth:
            spec = SUB_AGENTS["report_synthesizer"]
            await _maybe_call(on_status, f"{spec.name} is synthesizing...")
            prior = "\n\n".join(f"=== {r['agent']} ===\n{r['output']}" for r in results)
            task_text = str(synth["task"])
            if prior:
                task_text += f"\n\n## Findings from other agents:\n{prior}"
            out = await self._invoke_subagent(spec, task_text, self.model)
            results.append({"agent": "report_synthesizer", "output": out})

        final_output = results[-1]["output"] if results else "No output generated."
        await self._persist.add_history("agent", final_output)
        return final_output

    async def run_full_scan(
        self,
        on_status: Callable[[str, str], Awaitable[None] | None] | None = None,
    ) -> list[dict[str, str]]:
        await self.init()
        order = [
            "secret_hygiene_scanner",
            "solana_vulnerability_analyst",
            "defi_security_auditor",
            "rug_pull_detector",
            "supply_chain_analyst",
            "report_synthesizer",
        ]
        results: list[dict[str, str]] = []
        for name in order:
            spec = SUB_AGENTS.get(name)
            if not spec:
                continue
            await _maybe_call(on_status, name, "running")
            try:
                base_task = f"Run a comprehensive analysis: {spec.description} on repository {self.repo_root}"
                if name == "report_synthesizer" and results:
                    prior = "\n\n".join(f"=== {r['agent']} ===\n{r['output']}" for r in results)
                    base_task = (
                        f"Synthesize all findings into a professional security assessment for {self.repo_root}.\n\n{prior}"
                    )
                out = await self._invoke_subagent(spec, base_task, self.model)
                results.append({"agent": name, "output": out})
                await _maybe_call(on_status, name, "done")
            except Exception as exc:  # noqa: BLE001
                results.append({"agent": name, "output": f"[Error] {exc}"})
                await _maybe_call(on_status, name, "error")

        scan_path = os.path.join(self.repo_root, ".asst", "last-scan.json")
        os.makedirs(os.path.dirname(scan_path), exist_ok=True)
        with open(scan_path, "w", encoding="utf-8") as f:
            json.dump({"results": results}, f, ensure_ascii=False, indent=2)

        return results
