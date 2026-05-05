#!/usr/bin/env python3
"""Tier-A eval harness — gate Python stack vs frozen corpora (plan Phase 9 / 10A.7)."""

from __future__ import annotations


def main() -> None:
    print("Tier-A eval (agent-py) — wire benchmark driver to POST /v1/scan + scorer.")
    print("Promotion criteria (any ≥1):")
    print("  • +5% precision on Critical vs baseline without KB")
    print("  • +1 net true positive per 10 scans vs baseline")
    print("  • 0 fabricated CVE IDs in a 50-finding manual sample")
    print("Corpus: deepagentsjs/libs/dataset/benchmark-tier-a")


if __name__ == "__main__":
    main()
