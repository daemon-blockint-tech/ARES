from __future__ import annotations

from typing import Any
from urllib.parse import quote

import httpx

from ares_plugin.config import get_settings


async def kb_rpc(table: str, params: dict[str, str]) -> dict[str, Any] | list[Any]:
    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_service_role_key:
        return {"degraded": True, "results": [], "reason": "supabase not configured"}
    base = settings.supabase_url.rstrip("/") + f"/rest/v1/{table}"
    headers = {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "Accept": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.get(base, params=params, headers=headers)
        r.raise_for_status()
        return r.json()
    except Exception as exc:
        return {"degraded": True, "results": [], "error": str(exc)}


async def kb_post_rows(
    table: str,
    rows: list[dict[str, Any]],
    *,
    prefer_merge: bool = False,
    on_conflict: str | None = None,
) -> dict[str, Any]:
    """POST JSON rows to PostgREST (insert or upsert when prefer_merge + on_conflict)."""
    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_service_role_key:
        return {"degraded": True, "reason": "supabase not configured"}
    base = settings.supabase_url.rstrip("/") + f"/rest/v1/{table}"
    if on_conflict:
        base = f"{base}?on_conflict={quote(on_conflict, safe='')}"
    headers = {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    if prefer_merge:
        headers["Prefer"] = "resolution=merge-duplicates,return=minimal"
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(base, headers=headers, json=rows)
        r.raise_for_status()
        return {"ok": True, "status_code": r.status_code}
    except Exception as exc:
        return {"degraded": True, "error": str(exc)}
