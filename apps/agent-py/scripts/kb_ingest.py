#!/usr/bin/env python3
"""Ingest CVE/CWE CSV into Supabase `kb_vuln_records` (idempotent upsert + row checkpoint)."""

from __future__ import annotations

import argparse
import csv
import os
import time
from pathlib import Path
from typing import Any

import httpx


def _settings() -> dict[str, str]:
    return {
        "url": os.environ.get("AGENTPY_SUPABASE_URL", os.environ.get("SUPABASE_URL", "")).rstrip("/"),
        "key": os.environ.get(
            "AGENTPY_SUPABASE_SERVICE_ROLE_KEY",
            os.environ.get("SUPABASE_SERVICE_ROLE_KEY", ""),
        ),
        "openai": os.environ.get("OPENAI_API_KEY", ""),
        "embed_model": os.environ.get("AGENTPY_EMBEDDING_MODEL", "text-embedding-3-small"),
    }


def _embed_batch(texts: list[str], api_key: str, model: str) -> list[list[float]]:
    r = httpx.post(
        "https://api.openai.com/v1/embeddings",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={"model": model, "input": texts},
        timeout=120.0,
    )
    r.raise_for_status()
    data = r.json()["data"]
    data.sort(key=lambda x: x["index"])
    return [d["embedding"] for d in data]


def _upsert_vuln(rows: list[dict[str, Any]], url: str, key: str) -> None:
    endpoint = f"{url}/rest/v1/kb_vuln_records?on_conflict=source%2Csource_id"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    r = httpx.post(endpoint, headers=headers, json=rows, timeout=120.0)
    r.raise_for_status()


def cmd_status() -> None:
    s = _settings()
    print("kb_ingest status:")
    print("  supabase:", "ok" if s["url"] and s["key"] else "missing AGENTPY_SUPABASE_URL / _SERVICE_ROLE_KEY")
    print("  openai:", "ok" if s["openai"] else "missing OPENAI_API_KEY")
    print("  embed_model:", s["embed_model"])


def cmd_cve(args: argparse.Namespace) -> None:
    s = _settings()
    if not s["url"] or not s["key"] or not s["openai"]:
        raise SystemExit(
            "Need AGENTPY_SUPABASE_URL, AGENTPY_SUPABASE_SERVICE_ROLE_KEY, and OPENAI_API_KEY",
        )
    csv_path = Path(args.csv)
    if not csv_path.is_file():
        raise SystemExit(f"CSV not found: {csv_path}")
    ck_path = Path(args.checkpoint)
    start = int(ck_path.read_text().strip() or "0") if ck_path.is_file() else 0

    batch_texts: list[str] = []
    batch_rows: list[dict[str, Any]] = []
    embed_batch_size = int(args.batch_embed)
    last_row_index = start - 1

    with csv_path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for i, row in enumerate(reader):
            if i < start:
                continue
            cve = row.get("CVE-ID") or row.get("cve_id") or ""
            if not cve:
                continue
            desc = (row.get("DESCRIPTION") or row.get("description") or "")[:12000]
            sev = (row.get("SEVERITY") or row.get("severity") or "")[:32]
            cwe_raw = row.get("CWE-ID") or row.get("cwe_id") or ""
            cwes = [x.strip() for x in str(cwe_raw).split(",") if x.strip()][:24]
            text = f"{cve}\n{sev}\n{desc}"
            rec: dict[str, Any] = {
                "source": args.source,
                "source_id": cve,
                "title": cve,
                "description": desc,
                "severity": sev or None,
                "cwe_ids": cwes or None,
                "meta": {"ingest": "kb_ingest.cve", "csv_row": i},
            }
            batch_texts.append(text)
            batch_rows.append(rec)
            last_row_index = i
            if len(batch_texts) >= embed_batch_size:
                embs = _embed_batch(batch_texts, s["openai"], s["embed_model"])
                for rec, emb in zip(batch_rows, embs, strict=True):
                    rec["embedding"] = emb
                _upsert_vuln(batch_rows, s["url"], s["key"])
                ck_path.write_text(str(last_row_index + 1), encoding="utf-8")
                print(f"checkpoint row {last_row_index + 1} (+{len(batch_rows)} upserted)")
                batch_texts.clear()
                batch_rows.clear()
                time.sleep(float(args.sleep))
        if batch_texts:
            embs = _embed_batch(batch_texts, s["openai"], s["embed_model"])
            for rec, emb in zip(batch_rows, embs, strict=True):
                rec["embedding"] = emb
            _upsert_vuln(batch_rows, s["url"], s["key"])
            ck_path.write_text(str(last_row_index + 1), encoding="utf-8")
            print(f"final +{len(batch_rows)} upserted (checkpoint {last_row_index + 1})")


def cmd_stub(name: str) -> None:
    print(
        f"kb_ingest {name}: not implemented in this pass — extend like `cve` "
        f"(embed + upsert). See plan Phase 10A.3.",
    )


def main() -> None:
    p = argparse.ArgumentParser(description="KB ETL into Supabase (Track A)")
    sub = p.add_subparsers(dest="cmd", required=True)

    p_status = sub.add_parser("status", help="Print env readiness")
    p_status.set_defaults(func=lambda _: cmd_status())

    p_cve = sub.add_parser("cve", help="Ingest CVE CSV into kb_vuln_records")
    p_cve.add_argument(
        "--csv",
        default="dataset/cve-and-cwe-dataset-1999-2025/CVE_CWE_2025.csv",
        help="Path to CVE_CWE CSV (monorepo-relative or absolute)",
    )
    p_cve.add_argument(
        "--checkpoint",
        default=".asst/kb_ingest_cve.checkpoint",
        help="1-based next CSV row index to resume from",
    )
    p_cve.add_argument("--source", default="cve-cwe-2025", help="kb_vuln_records.source")
    p_cve.add_argument("--batch-embed", type=int, default=32, help="OpenAI embedding batch size")
    p_cve.add_argument("--sleep", type=float, default=0.2, help="Seconds between flushes")
    p_cve.set_defaults(func=cmd_cve)

    sub.add_parser("exemplars", help="Placeholder (audit exemplars parquet/JSONL)").set_defaults(
        func=lambda _: cmd_stub("exemplars"),
    )
    sub.add_parser("code", help="Placeholder (Solana code corpus)").set_defaults(
        func=lambda _: cmd_stub("code"),
    )
    sub.add_parser("attack-vectors", help="Placeholder (attack-vector writeups)").set_defaults(
        func=lambda _: cmd_stub("attack-vectors"),
    )

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
