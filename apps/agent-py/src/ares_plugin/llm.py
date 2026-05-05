"""Map ``google:gemini-2.5-flash``-style ids to LiteLLM model strings."""

from __future__ import annotations

import os


def to_litellm_model(model_id: str) -> str:
    mid = (model_id or "").strip()
    if "@" in mid:
        mid = mid.split("@", 1)[0]
    if ":" not in mid:
        return f"gemini/{mid}"
    provider, rest = mid.split(":", 1)
    p = provider.lower().strip()
    if p == "google":
        return f"gemini/{rest.strip()}"
    if p == "openai":
        return rest.strip()
    if p == "openrouter":
        return f"openrouter/{rest.strip()}"
    if p == "ollama":
        return f"ollama/{rest.strip()}"
    return mid


def ensure_api_keys_for_model(litellm_model: str) -> None:
    # LiteLLM reads standard env vars; nothing to do here beyond sanity checks.
    if litellm_model.startswith("gemini/") and not os.environ.get("GOOGLE_API_KEY"):
        raise RuntimeError("GOOGLE_API_KEY is required for Google Gemini models.")
    if litellm_model.startswith("openrouter/") and not os.environ.get("OPENROUTER_API_KEY"):
        raise RuntimeError("OPENROUTER_API_KEY is required for OpenRouter models.")
