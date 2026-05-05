"""Ported assurance tools — JSON-string results compatible with TS ``ToolResult`` envelopes."""

from __future__ import annotations

import asyncio
import json
import os
import re
import subprocess
from pathlib import Path
from typing import Any

import httpx

ROOT_ENV = "ASST_REPO_ROOT"


def _root() -> Path:
    return Path(os.environ.get(ROOT_ENV) or os.getcwd()).resolve()


def _safe_join(rel: str) -> Path | None:
    root = _root()
    cand = (root / rel).resolve() if rel else root
    try:
        cand.relative_to(root)
    except ValueError:
        return None
    return cand


def _envelope(
    tool: str,
    status: str,
    findings: list[dict[str, Any]] | None = None,
    human_summary: str = "",
    meta: dict[str, Any] | None = None,
) -> str:
    findings = findings or []
    by_sev = {"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0}
    for f in findings:
        s = str(f.get("severity", "info")).lower()
        if s in by_sev:
            by_sev[s] += 1
    worst = "info"
    for k in ("critical", "high", "medium", "low", "info"):
        if by_sev.get(k, 0) > 0:
            worst = k
            break
    payload = {
        "version": 1,
        "tool": tool,
        "status": status,
        "findings": findings,
        "summary": {
            "total": len(findings),
            "bySeverity": {k.capitalize(): v for k, v in by_sev.items()},
            "worstSeverity": worst.capitalize(),
        },
        "humanSummary": human_summary or f"## {tool} — status: {status}",
        "meta": meta or {},
    }
    return json.dumps(payload, ensure_ascii=False)


async def read_file(args: dict[str, Any], **_kw: Any) -> str:
    path = str(args.get("path", ""))
    p = _safe_join(path) if path and not os.path.isabs(path) else Path(path).resolve()
    if p is None or not str(p).startswith(str(_root())):
        return f"Error reading file {path}: path is outside repository root"
    try:
        return p.read_text(encoding="utf-8", errors="replace")
    except OSError as e:
        return f"Error reading file {path}: {e}"


async def solana_rpc_read(args: dict[str, Any], **_kw: Any) -> str:
    rpc = os.environ.get("SOLANA_RPC_URL", "https://api.devnet.solana.com")
    body = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": str(args.get("method", "getHealth")),
        "params": list(args.get("params") or []),
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.post(rpc, json=body, headers={"Content-Type": "application/json"})
    return f"status={r.status_code}\n{r.text}"


async def secret_scanner(args: dict[str, Any], **_kw: Any) -> str:
    """Heuristic secret scan (subset of TS patterns)."""
    root = _root()
    max_files = int(args.get("max_files", 400))
    patterns: list[tuple[str, re.Pattern[str]]] = [
        ("AWS Access Key", re.compile(r"AKIA[0-9A-Z]{16}")),
        ("GitHub Token", re.compile(r"gh[pousr]_[A-Za-z0-9_]{36,}")),
        ("OpenAI Key", re.compile(r"sk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20}")),
        ("Google API Key", re.compile(r"AIzaSy[A-Za-z0-9_-]{33}")),
        ("Generic API Key", re.compile(r"(?:api[_-]?key|apikey)\s*[:=]\s*['\"]([A-Za-z0-9_\-/.+]{20,})['\"]", re.I)),
    ]
    findings: list[dict[str, Any]] = []
    count = 0
    skip = {".git", "node_modules", "dist", ".next", "target"}
    for fp in root.rglob("*"):
        if fp.is_dir():
            continue
        if any(part in skip for part in fp.parts):
            continue
        if fp.suffix.lower() not in {".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".env", ".toml", ".yaml", ".yml"}:
            continue
        count += 1
        if count > max_files:
            break
        try:
            text = fp.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        rel = str(fp.relative_to(root))
        for name, rx in patterns:
            for m in rx.finditer(text):
                findings.append(
                    {
                        "id": f"{name}:{rel}:{m.start()}",
                        "severity": "high",
                        "confidence": "medium",
                        "title": name,
                        "description": f"Pattern match in {rel}",
                        "location": {"path": rel, "startLine": text[: m.start()].count("\n") + 1},
                    }
                )
    return _envelope(
        "secret_scanner",
        "ok",
        findings[:500],
        human_summary=f"secret_scanner: {len(findings)} heuristic matches (capped display)",
    )


async def env_hygiene_check(_args: dict[str, Any], **_kw: Any) -> str:
    root = _root()
    ex = (root / ".env.example").is_file()
    gitignore = (root / ".gitignore").read_text(encoding="utf-8", errors="ignore") if (root / ".gitignore").is_file() else ""
    ignored_env = ".env" in gitignore.splitlines() or ".env*" in gitignore
    findings = []
    if not ex:
        findings.append(
            {
                "id": "env-no-example",
                "severity": "medium",
                "confidence": "high",
                "title": "Missing .env.example",
                "description": "Add a template env file for operators.",
            }
        )
    if not ignored_env:
        findings.append(
            {
                "id": "env-not-gitignored",
                "severity": "high",
                "confidence": "high",
                "title": ".env not clearly gitignored",
                "description": "Ensure real secrets are not committed.",
            }
        )
    return _envelope("env_hygiene_check", "ok", findings)


async def git_diff_summary(args: dict[str, Any], **_kw: Any) -> str:
    root = _root()
    sub = str(args.get("subcommand", "stat"))
    cmd = ["git", "-C", str(root), "diff", "--stat"] if sub == "stat" else ["git", "-C", str(root), "status", "--porcelain"]
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        out, err = await proc.communicate()
        return (out or err).decode("utf-8", errors="replace")[:200_000]
    except FileNotFoundError:
        return "git not found in PATH"


async def anchor_source_scanner(args: dict[str, Any], **_kw: Any) -> str:
    """Light Anchor/Rust heuristics (placeholder parity with TS depth)."""
    root = _root()
    rel = str(args.get("path", "."))
    base = _safe_join(rel) or root
    findings: list[dict[str, Any]] = []
    for fp in base.rglob("*.rs"):
        if "target" in fp.parts:
            continue
        try:
            text = fp.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        if "#[account(" in text and "mut" in text and "Signer" not in text:
            findings.append(
                {
                    "id": f"anchor:{fp.relative_to(root)}:mut",
                    "severity": "medium",
                    "confidence": "low",
                    "title": "Suspicious mutable account without obvious Signer type",
                    "description": "Manual review recommended.",
                    "location": {"path": str(fp.relative_to(root))},
                }
            )
    return _envelope("anchor_source_scanner", "ok", findings[:200])


async def program_account_analyzer(args: dict[str, Any], **_kw: Any) -> str:
    pid = str(args.get("program_id", ""))
    return json.dumps(
        {
            "version": 1,
            "tool": "program_account_analyzer",
            "status": "skipped",
            "findings": [],
            "humanSummary": f"program_account_analyzer stub for program_id={pid}; use solana_rpc_read for live data.",
        },
        ensure_ascii=False,
    )


async def program_upgrade_monitor(args: dict[str, Any], **_kw: Any) -> str:
    return json.dumps(
        {
            "version": 1,
            "tool": "program_upgrade_monitor",
            "status": "skipped",
            "findings": [],
            "humanSummary": "Stub — configure Solana RPC and extend for upgrade authority checks.",
        },
        ensure_ascii=False,
    )


async def account_state_snapshot(args: dict[str, Any], **_kw: Any) -> str:
    out_dir = _root() / "assurance" / "snapshots"
    out_dir.mkdir(parents=True, exist_ok=True)
    return json.dumps(
        {
            "version": 1,
            "tool": "account_state_snapshot",
            "status": "skipped",
            "findings": [],
            "humanSummary": f"Stub snapshot dir ready at {out_dir}",
        },
        ensure_ascii=False,
    )


async def cpi_graph_mapper(args: dict[str, Any], **_kw: Any) -> str:
    return json.dumps(
        {
            "version": 1,
            "tool": "cpi_graph_mapper",
            "status": "skipped",
            "findings": [],
            "humanSummary": "Stub CPI graph — port IDL walker from TS when needed.",
        },
        ensure_ascii=False,
    )


async def token_concentration_analyzer(args: dict[str, Any], **_kw: Any) -> str:
    return json.dumps(
        {
            "version": 1,
            "tool": "token_concentration_analyzer",
            "status": "skipped",
            "findings": [],
            "humanSummary": "Stub — supply mint + RPC holder analysis from TS.",
        },
        ensure_ascii=False,
    )


async def git_clone_repo(args: dict[str, Any], **_kw: Any) -> str:
    if os.environ.get("ASST_ALLOW_WRITE", "1") != "1":
        return json.dumps({"error": "mutating tool disabled (ASST_ALLOW_WRITE!=1)"})
    return json.dumps({"status": "skipped", "reason": "git_clone_repo not executed in agent-py v1 stub"})


async def merge_findings(args: dict[str, Any], **_kw: Any) -> str:
    paths = args.get("paths") or []
    merged: list[Any] = []
    root = _root()
    for p in paths:
        fp = Path(str(p))
        if not fp.is_absolute():
            fp = root / fp
        if not str(fp.resolve()).startswith(str(root)):
            continue
        if fp.is_file():
            try:
                data = json.loads(fp.read_text(encoding="utf-8"))
                if isinstance(data, list):
                    merged.extend(data)
            except (OSError, json.JSONDecodeError):
                continue
    return json.dumps({"merged": len(merged), "sample": merged[:20]}, ensure_ascii=False)


async def write_assurance_manifest(_args: dict[str, Any], **_kw: Any) -> str:
    if os.environ.get("ASST_ALLOW_WRITE", "1") != "1":
        return json.dumps({"error": "mutating tool disabled"})
    return json.dumps({"status": "skipped", "note": "Wire deepagentsjs manifest writer if needed."})


async def unified_posture_report(args: dict[str, Any], **_kw: Any) -> str:
    layers = args.get("layers") or []
    return json.dumps(
        {
            "version": 1,
            "tool": "unified_posture_report",
            "status": "ok",
            "humanSummary": "Posture aggregation (stub): input layers count=" + str(len(layers)),
        },
        ensure_ascii=False,
    )


async def generate_pdf_report(_args: dict[str, Any], **_kw: Any) -> str:
    return json.dumps({"status": "skipped", "note": "PDF generation remains a dashboard export path in v1."})


def _run_semgrep_sync(cwd: Path, out_dir: Path) -> dict[str, Any]:
    out_dir.mkdir(parents=True, exist_ok=True)
    sarif_path = out_dir / "semgrep.sarif.json"
    try:
        proc = subprocess.run(
            ["semgrep", "--config", "auto", "--sarif", "-o", str(sarif_path), "."],
            cwd=str(cwd),
            capture_output=True,
            text=True,
            timeout=600,
            check=False,
        )
        return {"status": "ok" if proc.returncode == 0 else "partial", "exitCode": proc.returncode, "sarifPath": str(sarif_path)}
    except FileNotFoundError:
        return {"status": "skipped", "reason": "semgrep not found in PATH"}
    except subprocess.TimeoutExpired:
        return {"status": "error", "reason": "timeout"}


async def run_semgrep_assurance(args: dict[str, Any], **_kw: Any) -> str:
    rel = str(args.get("target", "."))
    base = _safe_join(rel) or _root()
    out = _root() / "assurance"
    loop = asyncio.get_running_loop()
    res = await loop.run_in_executor(None, lambda: _run_semgrep_sync(base, out))
    return json.dumps(res, ensure_ascii=False)


TOOLSET = "ares-assurance"

# OpenAI-style JSON schemas (parameters only) for Hermes / LiteLLM
_SCHEMA_READ_FILE = {
    "type": "object",
    "properties": {"path": {"type": "string", "description": "Path relative to repo root"}},
    "required": ["path"],
}

_SCHEMA_SOLANA = {
    "type": "object",
    "properties": {
        "method": {"type": "string"},
        "params": {"type": "array", "items": {}},
    },
    "required": ["method"],
}

_SCHEMA_EMPTY = {"type": "object", "properties": {}, "additionalProperties": True}

_SCHEMA_GIT_DIFF = {
    "type": "object",
    "properties": {"subcommand": {"type": "string", "enum": ["stat", "status"], "default": "stat"}},
}

_SCHEMA_ANCHOR = {
    "type": "object",
    "properties": {"path": {"type": "string", "default": "."}},
}

_SCHEMA_PROG = {
    "type": "object",
    "properties": {"program_id": {"type": "string"}},
    "required": ["program_id"],
}

_SCHEMA_MERGE = {
    "type": "object",
    "properties": {"paths": {"type": "array", "items": {"type": "string"}}},
    "required": ["paths"],
}

_SCHEMA_POSTURE = {
    "type": "object",
    "properties": {"layers": {"type": "array", "items": {}}},
}

_SCHEMA_SECRET = {"type": "object", "properties": {"max_files": {"type": "integer", "default": 400}}}

_SCHEMA_SEMGREP = {"type": "object", "properties": {"target": {"type": "string", "default": "."}}}


def _fn_schema(name: str, desc: str, parameters: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": name,
        "description": desc,
        "parameters": parameters,
    }


def register_assurance_tools(ctx: Any) -> None:
    specs: list[tuple[str, dict[str, Any], Any, str, bool]] = [
        ("read_file", _fn_schema("read_file", "Read file under repo root", _SCHEMA_READ_FILE), read_file, "Read a file from the repository.", True),
        ("solana_rpc_read", _fn_schema("solana_rpc_read", "Solana JSON-RPC read", _SCHEMA_SOLANA), solana_rpc_read, "POST JSON-RPC to Solana RPC.", True),
        ("secret_scanner", _fn_schema("secret_scanner", "Heuristic secret scan", _SCHEMA_SECRET), secret_scanner, "Scan repo files for secret patterns.", True),
        ("env_hygiene_check", _fn_schema("env_hygiene_check", "Check .env.example / .gitignore", _SCHEMA_EMPTY), env_hygiene_check, "Environment hygiene checks.", True),
        ("git_diff_summary", _fn_schema("git_diff_summary", "Git diff stat or status", _SCHEMA_GIT_DIFF), git_diff_summary, "Summarize git changes.", True),
        ("anchor_source_scanner", _fn_schema("anchor_source_scanner", "Heuristic Anchor/Rust scan", _SCHEMA_ANCHOR), anchor_source_scanner, "Static patterns in Rust sources.", True),
        ("program_account_analyzer", _fn_schema("program_account_analyzer", "Program accounts", _SCHEMA_PROG), program_account_analyzer, "Summarize program-owned accounts (stub).", True),
        ("program_upgrade_monitor", _fn_schema("program_upgrade_monitor", "Upgrade authority", _SCHEMA_PROG), program_upgrade_monitor, "Program upgrade authorities (stub).", True),
        ("account_state_snapshot", _fn_schema("account_state_snapshot", "Snapshot account", _SCHEMA_EMPTY), account_state_snapshot, "Account snapshot writer (stub).", True),
        ("cpi_graph_mapper", _fn_schema("cpi_graph_mapper", "CPI graph", _SCHEMA_EMPTY), cpi_graph_mapper, "Map CPI surface (stub).", True),
        ("token_concentration_analyzer", _fn_schema("token_concentration_analyzer", "Token concentration", _SCHEMA_EMPTY), token_concentration_analyzer, "Holder concentration (stub).", True),
        ("git_clone_repo", _fn_schema("git_clone_repo", "Clone external repo", _SCHEMA_EMPTY), git_clone_repo, "Clone external git target (guarded).", True),
        ("merge_findings", _fn_schema("merge_findings", "Merge SARIF JSON lists", _SCHEMA_MERGE), merge_findings, "Merge findings files.", True),
        ("write_assurance_manifest", _fn_schema("write_assurance_manifest", "Write manifest", _SCHEMA_EMPTY), write_assurance_manifest, "Write assurance manifest (stub).", True),
        ("unified_posture_report", _fn_schema("unified_posture_report", "Posture report", _SCHEMA_POSTURE), unified_posture_report, "Unified posture scoring.", True),
        ("generate_pdf_report", _fn_schema("generate_pdf_report", "PDF report", _SCHEMA_EMPTY), generate_pdf_report, "Generate PDF (stub).", True),
        ("run_semgrep", _fn_schema("run_semgrep", "Run semgrep SARIF", _SCHEMA_SEMGREP), run_semgrep_assurance, "Run Semgrep with SARIF output.", True),
    ]
    for name, schema, handler, desc, is_async in specs:
        ctx.register_tool(
            name=name,
            toolset=TOOLSET,
            schema=schema,
            handler=handler,
            is_async=is_async,
            description=desc,
        )


# ---- Standalone dispatch (FastAPI / tests) ---------------------------------

_ASSURANCE_HANDLERS: dict[str, Any] = {
    "read_file": read_file,
    "solana_rpc_read": solana_rpc_read,
    "secret_scanner": secret_scanner,
    "env_hygiene_check": env_hygiene_check,
    "git_diff_summary": git_diff_summary,
    "anchor_source_scanner": anchor_source_scanner,
    "program_account_analyzer": program_account_analyzer,
    "program_upgrade_monitor": program_upgrade_monitor,
    "account_state_snapshot": account_state_snapshot,
    "cpi_graph_mapper": cpi_graph_mapper,
    "token_concentration_analyzer": token_concentration_analyzer,
    "git_clone_repo": git_clone_repo,
    "merge_findings": merge_findings,
    "write_assurance_manifest": write_assurance_manifest,
    "unified_posture_report": unified_posture_report,
    "generate_pdf_report": generate_pdf_report,
    "run_semgrep": run_semgrep_assurance,
}


async def dispatch_assurance_tool(name: str, args: dict[str, Any]) -> str:
    fn = _ASSURANCE_HANDLERS.get(name)
    if not fn:
        return json.dumps({"error": f"unknown assurance tool {name}"})
    return await fn(args)


async def dispatch_any_tool(name: str, args: dict[str, Any]) -> str:
    if name.startswith("kb_"):
        from ares_plugin.tools import kb_tools as kbt

        kb_map = {
            "kb_search_cve": kbt.kb_search_cve,
            "kb_find_exemplars": kbt.kb_find_exemplars,
            "kb_lookup_attack_vector": kbt.kb_lookup_attack_vector,
            "kb_log_retrieval": kbt.kb_log_retrieval,
        }
        fn = kb_map.get(name)
        if fn:
            return await fn(args, **{})
    return await dispatch_assurance_tool(name, args)


def openai_tools_definitions() -> list[dict[str, Any]]:
    """Tool definitions for LiteLLM (OpenAI chat completions format)."""
    out: list[dict[str, Any]] = []
    for name, schema in [
        ("read_file", _fn_schema("read_file", "Read file under repo root", _SCHEMA_READ_FILE)),
        ("solana_rpc_read", _fn_schema("solana_rpc_read", "Solana JSON-RPC read", _SCHEMA_SOLANA)),
        ("secret_scanner", _fn_schema("secret_scanner", "Heuristic secret scan", _SCHEMA_SECRET)),
        ("env_hygiene_check", _fn_schema("env_hygiene_check", "Env hygiene", _SCHEMA_EMPTY)),
        ("git_diff_summary", _fn_schema("git_diff_summary", "Git diff/status", _SCHEMA_GIT_DIFF)),
        ("anchor_source_scanner", _fn_schema("anchor_source_scanner", "Anchor/Rust heuristics", _SCHEMA_ANCHOR)),
        ("run_semgrep", _fn_schema("run_semgrep", "Run semgrep", _SCHEMA_SEMGREP)),
        (
            "program_account_analyzer",
            _fn_schema("program_account_analyzer", "Program owned accounts", _SCHEMA_PROG),
        ),
        (
            "program_upgrade_monitor",
            _fn_schema("program_upgrade_monitor", "Program upgrade authorities", _SCHEMA_PROG),
        ),
        ("account_state_snapshot", _fn_schema("account_state_snapshot", "Account snapshot", _SCHEMA_EMPTY)),
        ("cpi_graph_mapper", _fn_schema("cpi_graph_mapper", "CPI graph", _SCHEMA_EMPTY)),
        (
            "token_concentration_analyzer",
            _fn_schema("token_concentration_analyzer", "Token holder concentration", _SCHEMA_EMPTY),
        ),
        ("git_clone_repo", _fn_schema("git_clone_repo", "Clone external git repo", _SCHEMA_EMPTY)),
        ("merge_findings", _fn_schema("merge_findings", "Merge findings JSON files", _SCHEMA_MERGE)),
        ("write_assurance_manifest", _fn_schema("write_assurance_manifest", "Write assurance manifest", _SCHEMA_EMPTY)),
        (
            "unified_posture_report",
            _fn_schema("unified_posture_report", "Unified posture report", _SCHEMA_POSTURE),
        ),
        ("generate_pdf_report", _fn_schema("generate_pdf_report", "Generate PDF report", _SCHEMA_EMPTY)),
        (
            "kb_search_cve",
            _fn_schema(
                "kb_search_cve",
                "Search CVE / vulnerability KB",
                {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string"},
                        "top_k": {"type": "integer", "default": 5},
                        "cwe_filter": {"type": "string"},
                        "severity_min": {"type": "string"},
                    },
                    "required": ["query"],
                },
            ),
        ),
        (
            "kb_find_exemplars",
            _fn_schema(
                "kb_find_exemplars",
                "Find audit exemplars",
                {
                    "type": "object",
                    "properties": {
                        "code_snippet": {"type": "string"},
                        "language": {"type": "string"},
                        "top_k": {"type": "integer", "default": 3},
                    },
                    "required": ["code_snippet", "language"],
                },
            ),
        ),
        (
            "kb_lookup_attack_vector",
            _fn_schema(
                "kb_lookup_attack_vector",
                "Lookup attack-vector KB entries",
                {
                    "type": "object",
                    "properties": {
                        "category": {"type": "string"},
                        "language": {"type": "string", "default": "rust"},
                    },
                    "required": ["category"],
                },
            ),
        ),
        (
            "kb_log_retrieval",
            _fn_schema(
                "kb_log_retrieval",
                "Log KB row ids used for a finding",
                {
                    "type": "object",
                    "properties": {
                        "run_id": {"type": "string"},
                        "finding_id": {"type": "string"},
                        "kb_ids": {"type": "array", "items": {"type": "string"}},
                    },
                    "required": ["run_id", "finding_id", "kb_ids"],
                },
            ),
        ),
    ]:
        out.append({"type": "function", "function": schema})
    return out
