"""Read assurance artifacts from ``ASST_REPO_ROOT`` (parity with Next.js ``getAssuranceData`` paths)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def _root(repo: str) -> Path:
    return Path(repo).resolve()


def load_findings(repo: str) -> list[dict[str, Any]]:
    root = _root(repo)
    findings: list[dict[str, Any]] = []
    sarif_path = root / "assurance" / "merged.sarif.json"
    if sarif_path.is_file():
        try:
            sarif = json.loads(sarif_path.read_text(encoding="utf-8"))
            for r in sarif.get("runs", [{}])[0].get("results", []):
                findings.append(
                    {
                        "source": "semgrep",
                        "severity": "High"
                        if r.get("level") == "error"
                        else "Medium"
                        if r.get("level") == "warning"
                        else "Low",
                        "rule": r.get("ruleId", "unknown"),
                        "message": (r.get("message") or {}).get("text", ""),
                        "location": (r.get("locations") or [{}])[0]
                        .get("physicalLocation", {})
                        .get("artifactLocation", {})
                        .get("uri", ""),
                        "line": (r.get("locations") or [{}])[0]
                        .get("physicalLocation", {})
                        .get("region", {})
                        .get("startLine", 0),
                    }
                )
        except (json.JSONDecodeError, OSError):
            pass
    scan_path = root / ".asst" / "last-scan.json"
    if scan_path.is_file():
        try:
            scan = json.loads(scan_path.read_text(encoding="utf-8"))
            for result in scan.get("results", []):
                out = str(result.get("output", ""))
                if "Critical" in out or "EXPOSURE" in out:
                    findings.append(
                        {
                            "source": result.get("agent", "agent"),
                            "severity": "Critical" if "Critical" in out else "High",
                            "rule": f"{result.get('agent')}-finding",
                            "message": out[:200],
                            "location": "scan-result",
                            "line": 0,
                        }
                    )
        except (json.JSONDecodeError, OSError):
            pass
    order = {"Critical": 0, "High": 1, "Medium": 2, "Low": 3, "Informational": 4}
    findings.sort(key=lambda x: order.get(str(x.get("severity")), 4))
    return findings


def load_runs(repo: str) -> list[dict[str, Any]]:
    root = _root(repo)
    manifests_dir = root / "assurance" / "manifests"
    if not manifests_dir.is_dir():
        return []
    runs: list[dict[str, Any]] = []
    for fp in sorted(manifests_dir.glob("*.json")):
        try:
            m = json.loads(fp.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        sha = (m.get("git") or {}).get("commit_sha") or ""
        runs.append(
            {
                "file": fp.name,
                "commit": sha[:7] if sha else "unknown",
                "branch": (m.get("git") or {}).get("branch") or "unknown",
                "timestamp": m.get("generated_at"),
                "semgrep": (m.get("static_analysis") or {}).get("semgrep", {}).get("status", "unknown"),
                "agentCount": m.get("agent_count", 0),
            }
        )
    return runs
