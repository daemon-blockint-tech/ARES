"""Supabase-backed KB tools (Track A) — degrade open when misconfigured."""

from __future__ import annotations

import json
from typing import Any

from ares_plugin.clients import supabase as supa

KB_TOOLSET = "ares-knowledge-base"


def _safe_ilike_fragment(s: str) -> str:
    return (
        s.replace("\\", "")
        .replace("*", "")
        .replace("(", "")
        .replace(")", "")
        .replace(",", " ")
        .strip()[:160]
    )


async def kb_search_cve(args: dict[str, Any], **_kw: Any) -> str:
    q = str(args.get("query", ""))
    top_k = int(args.get("top_k", 5))
    frag = _safe_ilike_fragment(q)
    params: dict[str, str] = {
        "select": "id,source,source_id,title,description,severity,cwe_ids",
        "limit": str(top_k),
        "order": "severity.desc.nullslast",
    }
    if frag:
        params["or"] = f"(title.ilike.*{frag}*,description.ilike.*{frag}*)"
    res = await supa.kb_rpc("kb_vuln_records", params)
    if isinstance(res, dict) and res.get("degraded"):
        return json.dumps(res, ensure_ascii=False)
    return json.dumps({"results": res}, ensure_ascii=False)


async def kb_find_exemplars(args: dict[str, Any], **_kw: Any) -> str:
    snippet = str(args.get("code_snippet", ""))[:2000]
    lang = str(args.get("language", "rust"))
    top_k = int(args.get("top_k", 3))
    frag = _safe_ilike_fragment(snippet[:200])
    params: dict[str, str] = {
        "select": "id,source,language,body",
        "limit": str(top_k),
        "language": f"eq.{lang}",
    }
    if frag:
        params["body"] = f"ilike.*{frag}*"
    res = await supa.kb_rpc("kb_audit_exemplars", params)
    if isinstance(res, dict) and res.get("degraded"):
        return json.dumps(res, ensure_ascii=False)
    return json.dumps({"results": res}, ensure_ascii=False)


async def kb_lookup_attack_vector(args: dict[str, Any], **_kw: Any) -> str:
    cat = str(args.get("category", ""))
    frag = _safe_ilike_fragment(cat)
    params: dict[str, str] = {
        "select": "id,title,description,meta,source_id",
        "limit": "10",
        "source": "eq.attack-vectors",
    }
    if frag:
        params["or"] = f"(title.ilike.*{frag}*,description.ilike.*{frag}*)"
    res = await supa.kb_rpc("kb_vuln_records", params)
    if isinstance(res, dict) and res.get("degraded"):
        return json.dumps(res, ensure_ascii=False)
    return json.dumps({"results": res}, ensure_ascii=False)


async def kb_log_retrieval(args: dict[str, Any], **_kw: Any) -> str:
    row = {
        "run_id": str(args.get("run_id", "")),
        "finding_id": str(args.get("finding_id", "")),
        "kb_ids": list(args.get("kb_ids") or []),
    }
    res = await supa.kb_post_rows("kb_retrieval_logs", [row])
    return json.dumps({"status": "stored" if res.get("ok") else "degraded", "detail": res}, ensure_ascii=False)


def register_kb_tools(ctx: Any) -> None:
    ctx.register_tool(
        "kb_search_cve",
        KB_TOOLSET,
        {
            "name": "kb_search_cve",
            "description": "Search CVE / vulnerability records in the KB.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "top_k": {"type": "integer", "default": 5},
                    "cwe_filter": {"type": "string"},
                    "severity_min": {"type": "string"},
                },
                "required": ["query"],
            },
        },
        kb_search_cve,
        is_async=True,
        description="KB CVE search (pgvector-backed when configured).",
    )
    ctx.register_tool(
        "kb_find_exemplars",
        KB_TOOLSET,
        {
            "name": "kb_find_exemplars",
            "description": "Find similar audit exemplars for few-shot context.",
            "parameters": {
                "type": "object",
                "properties": {
                    "code_snippet": {"type": "string"},
                    "language": {"type": "string"},
                    "top_k": {"type": "integer", "default": 3},
                },
                "required": ["code_snippet", "language"],
            },
        },
        kb_find_exemplars,
        is_async=True,
        description="KB audit exemplars.",
    )
    ctx.register_tool(
        "kb_lookup_attack_vector",
        KB_TOOLSET,
        {
            "name": "kb_lookup_attack_vector",
            "description": "Lookup curated attack-vector writeups.",
            "parameters": {
                "type": "object",
                "properties": {
                    "category": {"type": "string"},
                    "language": {"type": "string", "default": "rust"},
                },
                "required": ["category"],
            },
        },
        kb_lookup_attack_vector,
        is_async=True,
        description="KB attack vectors.",
    )
    ctx.register_tool(
        "kb_log_retrieval",
        KB_TOOLSET,
        {
            "name": "kb_log_retrieval",
            "description": "Log which KB rows were used for a finding.",
            "parameters": {
                "type": "object",
                "properties": {
                    "run_id": {"type": "string"},
                    "finding_id": {"type": "string"},
                    "kb_ids": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["run_id", "finding_id", "kb_ids"],
            },
        },
        kb_log_retrieval,
        is_async=True,
        description="KB retrieval audit log.",
    )
