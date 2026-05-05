"""Hermes pip plugin entrypoint (``hermes_agent.plugins`` group)."""

from __future__ import annotations

from typing import Any

from ares_plugin.tools.assurance import register_assurance_tools
from ares_plugin.tools.kb_tools import register_kb_tools


def register(ctx: Any) -> None:
    register_assurance_tools(ctx)
    register_kb_tools(ctx)
