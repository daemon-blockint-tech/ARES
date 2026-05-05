"""FastAPI entrypoint for the ARES Python agent."""

from __future__ import annotations

import json
import logging
import os
import uuid

from arq import create_pool
from arq.connections import RedisSettings
from fastapi import FastAPI, Query, Request, Response
from fastapi.responses import JSONResponse
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from pydantic import BaseModel, Field

from ares_plugin.auth_hmac import verify_internal_hmac
from ares_plugin.config import get_settings
from ares_plugin.api import assurance_data
from ares_plugin.clients import supabase as supa_client
from ares_plugin.orchestrator import AresOrchestrator
from ares_plugin.runs_store import read_run, write_run

logger = logging.getLogger(__name__)

app = FastAPI(title="ARES agent-py", version="0.1.0")


class ChatBody(BaseModel):
    prompt: str
    model: str | None = None
    repo_root: str | None = None


class ScanBody(BaseModel):
    target: str = "."
    model: str | None = None
    repo_root: str | None = None


class FeedbackBody(BaseModel):
    run_id: str
    finding_id: str
    rating: int = Field(..., ge=-1, le=1)
    comment: str | None = None
    retrieved_kb_ids: list[str] | None = None


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/metrics")
async def metrics() -> Response:
    data = generate_latest()
    return Response(data, media_type=CONTENT_TYPE_LATEST)


def _repo(body_root: str | None) -> str:
    s = get_settings()
    return os.path.abspath(body_root or s.resolved_repo_root())


@app.post("/v1/chat")
async def v1_chat(request: Request) -> JSONResponse:
    raw = await request.body()
    verify_internal_hmac(
        raw,
        request.headers.get("x-asst-timestamp"),
        request.headers.get("x-asst-signature"),
    )
    data = json.loads(raw.decode("utf-8"))
    body = ChatBody.model_validate(data)
    repo = _repo(body.repo_root)
    os.environ["ASST_REPO_ROOT"] = repo
    orch = AresOrchestrator(repo, body.model)
    out = await orch.chat(body.prompt)
    return JSONResponse({"reply": out})


@app.post("/v1/scan")
async def v1_scan(request: Request) -> JSONResponse:
    raw = await request.body()
    verify_internal_hmac(
        raw,
        request.headers.get("x-asst-timestamp"),
        request.headers.get("x-asst-signature"),
    )
    data = json.loads(raw.decode("utf-8"))
    body = ScanBody.model_validate(data)
    repo = _repo(body.repo_root)
    os.environ["ASST_REPO_ROOT"] = repo
    run_id = str(uuid.uuid4())
    write_run(
        repo,
        run_id,
        {"status": "queued", "target": body.target, "model": body.model},
    )
    settings = get_settings()
    redis = await create_pool(RedisSettings.from_dsn(settings.redis_url))
    await redis.enqueue_job(
        "ares_plugin.arq_worker.run_full_scan_job",
        run_id,
        repo,
        body.model,
    )
    await redis.close()
    return JSONResponse({"status": "queued", "repo": repo, "run_id": run_id})


@app.get("/v1/runs/{run_id}")
async def v1_run_get(
    request: Request,
    run_id: str,
    repo_root: str | None = Query(None),
) -> JSONResponse:
    """Signed GET — body is empty; same HMAC scheme as POST (timestamp + sig over ``ts.``)."""
    verify_internal_hmac(
        b"",
        request.headers.get("x-asst-timestamp"),
        request.headers.get("x-asst-signature"),
    )
    repo = _repo(repo_root)
    row = read_run(repo, run_id)
    if not row:
        return JSONResponse({"error": "not_found"}, status_code=404)
    return JSONResponse(row)


@app.post("/v1/feedback")
async def v1_feedback(request: Request) -> JSONResponse:
    raw = await request.body()
    verify_internal_hmac(
        raw,
        request.headers.get("x-asst-timestamp"),
        request.headers.get("x-asst-signature"),
    )
    body = FeedbackBody.model_validate(json.loads(raw.decode("utf-8")))
    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_service_role_key:
        return JSONResponse({"status": "degraded", "note": "supabase not configured"}, status_code=200)
    row = [
        {
            "run_id": body.run_id,
            "finding_id": body.finding_id,
            "rating": body.rating,
            "comment": body.comment,
            "retrieved_kb_ids": body.retrieved_kb_ids or [],
        }
    ]
    res = await supa_client.kb_post_rows("kb_feedback", row)
    if res.get("ok"):
        return JSONResponse({"status": "stored"}, status_code=201)
    return JSONResponse({"status": "degraded", "detail": res}, status_code=503)


class HistoryBody(BaseModel):
    repo_root: str | None = None
    limit: int = 20


@app.post("/v1/history")
async def v1_history_post(request: Request) -> JSONResponse:
    raw = await request.body()
    verify_internal_hmac(
        raw,
        request.headers.get("x-asst-timestamp"),
        request.headers.get("x-asst-signature"),
    )
    body = HistoryBody.model_validate(json.loads(raw.decode("utf-8")))
    repo = _repo(body.repo_root)
    os.environ["ASST_REPO_ROOT"] = repo
    orch = AresOrchestrator(repo)
    rows = await orch.get_recent_history(body.limit)
    return JSONResponse({"messages": rows})


@app.post("/v1/findings")
async def v1_findings(request: Request) -> JSONResponse:
    raw = await request.body()
    verify_internal_hmac(
        raw,
        request.headers.get("x-asst-timestamp"),
        request.headers.get("x-asst-signature"),
    )
    body = HistoryBody.model_validate(json.loads(raw.decode("utf-8")))
    repo = _repo(body.repo_root)
    items = assurance_data.load_findings(repo)
    return JSONResponse({"findings": items})


@app.post("/v1/runs")
async def v1_runs(request: Request) -> JSONResponse:
    raw = await request.body()
    verify_internal_hmac(
        raw,
        request.headers.get("x-asst-timestamp"),
        request.headers.get("x-asst-signature"),
    )
    body = HistoryBody.model_validate(json.loads(raw.decode("utf-8")))
    repo = _repo(body.repo_root)
    runs = assurance_data.load_runs(repo)
    return JSONResponse({"total": len(runs), "runs": runs})


def run() -> None:
    import uvicorn

    host = os.environ.get("AGENTPY_HOST", "0.0.0.0")
    port = int(os.environ.get("AGENTPY_PORT", "8765"))
    uvicorn.run("ares_plugin.api.main:app", host=host, port=port, reload=False)
