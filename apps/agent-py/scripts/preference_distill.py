#!/usr/bin/env python3
"""Distill kb_feedback → kb_preference_pairs (batch job; LLM-judge optional)."""

from __future__ import annotations

import argparse
import json
import os
from typing import Any

import httpx


def _sb() -> tuple[str, str]:
    url = os.environ.get("AGENTPY_SUPABASE_URL", os.environ.get("SUPABASE_URL", "")).rstrip("/")
    key = os.environ.get(
        "AGENTPY_SUPABASE_SERVICE_ROLE_KEY",
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY", ""),
    )
    return url, key


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--limit", type=int, default=100)
    args = p.parse_args()
    url, key = _sb()
    if not url or not key:
        print("preference_distill: Supabase not configured — nothing to do.")
        return
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
    }
    endpoint = f"{url}/rest/v1/kb_feedback"
    r = httpx.get(
        endpoint,
        headers=headers,
        params={
            "select": "id,run_id,finding_id,rating,comment,retrieved_kb_ids,created_at",
            "order": "created_at.desc",
            "limit": str(args.limit),
        },
        timeout=30.0,
    )
    r.raise_for_status()
    rows: list[dict[str, Any]] = r.json()
    print(f"preference_distill: fetched {len(rows)} kb_feedback rows (dry-run).")
    if rows:
        print(json.dumps(rows[0], indent=2, default=str)[:800])


if __name__ == "__main__":
    main()
