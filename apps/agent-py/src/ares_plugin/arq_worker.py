"""Arq worker — background full scans."""

from __future__ import annotations

import logging
import os
import traceback
from typing import ClassVar

from arq.connections import RedisSettings

from ares_plugin.runs_store import read_run, write_run

logger = logging.getLogger(__name__)


async def run_full_scan_job(
    _ctx: dict,
    run_id: str,
    repo_root: str,
    model: str | None = None,
) -> None:
    os.environ["ASST_REPO_ROOT"] = repo_root
    from ares_plugin.orchestrator import AresOrchestrator

    write_run(
        repo_root,
        run_id,
        {
            "status": "running",
            "model": model,
        },
    )
    try:
        orch = AresOrchestrator(repo_root, model)

        async def _log(agent: str, status: str) -> None:
            logger.info("scan %s %s", agent, status)

        await orch.run_full_scan(on_status=_log)
        cur = read_run(repo_root, run_id) or {}
        write_run(
            repo_root,
            run_id,
            {
                **cur,
                "status": "completed",
            },
        )
    except Exception:
        cur = read_run(repo_root, run_id) or {}
        write_run(
            repo_root,
            run_id,
            {
                **cur,
                "status": "failed",
                "error": traceback.format_exc()[-8000:],
            },
        )
        raise


class WorkerSettings:
    functions = [run_full_scan_job]
    redis_settings = RedisSettings.from_dsn(os.environ.get("REDIS_URL", "redis://127.0.0.1:6379/0"))
    cron_jobs: ClassVar[list[object]] = []
