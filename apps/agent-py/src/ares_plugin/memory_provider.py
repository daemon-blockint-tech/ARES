"""Postgres-backed Hermes memory provider (Track A / Phase 3 extension point).

v1 ships with :class:`ares_plugin.persistence.JsonlPersistence` for chat history
in the FastAPI path. A future iteration can register a Hermes ``exclusive``
memory backend that mirrors SessionDB rows into Postgres for multi-tenant
``HERMES_HOME`` layouts described in the architecture plan.
"""

from __future__ import annotations
