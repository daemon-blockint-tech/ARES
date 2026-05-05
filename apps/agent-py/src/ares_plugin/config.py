from __future__ import annotations

import os
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="AGENTPY_", extra="ignore")

    internal_secret: str = ""
    redis_url: str = "redis://127.0.0.1:6379/0"
    default_model: str = "google:gemini-2.5-flash"
    repo_root: str = ""
    hermes_home_base: str = "/tmp/hermes-homes"
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    embedding_model: str = "text-embedding-3-small"
    use_hermes_ai_agent: bool = False

    def resolved_repo_root(self) -> str:
        return self.repo_root or os.environ.get("ASST_REPO_ROOT") or os.getcwd()


@lru_cache
def get_settings() -> Settings:
    return Settings()
