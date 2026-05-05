from __future__ import annotations

import hashlib
import hmac
import time
from typing import Annotated

from fastapi import Header, HTTPException

from ares_plugin.config import get_settings


def _timing_safe_equal(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))


def verify_internal_hmac(
    body: bytes,
    ts_header: str | None,
    sig_header: str | None,
) -> None:
    settings = get_settings()
    secret = settings.internal_secret or ""
    if len(secret) < 16:
        raise HTTPException(500, "AGENTPY_INTERNAL_SECRET not configured (min 16 chars)")
    if not ts_header or not sig_header:
        raise HTTPException(401, "Missing X-ASST-Timestamp or X-ASST-Signature")
    try:
        ts = int(ts_header)
    except ValueError as exc:
        raise HTTPException(401, "Invalid timestamp") from exc
    if abs(int(time.time()) - ts) > 300:
        raise HTTPException(401, "Stale timestamp")
    raw = f"{ts_header}.".encode("utf-8") + body
    expected = hmac.new(secret.encode("utf-8"), raw, hashlib.sha256).hexdigest()
    if not _timing_safe_equal(expected, sig_header):
        raise HTTPException(401, "Bad signature")


def HmacVerifiedBody(
    body: bytes,
    x_asst_timestamp: Annotated[str | None, Header()] = None,
    x_asst_signature: Annotated[str | None, Header(alias="X-ASST-Signature")] = None,
) -> bytes:
    verify_internal_hmac(body, x_asst_timestamp, x_asst_signature)
    return body
