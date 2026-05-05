# ARES monorepo — common dev entrypoints (plan: Python via uv, web via pnpm).
.PHONY: py-dev py-test py-build web-dev install-py install-web

install-py:
	cd apps/agent-py && uv sync --all-extras

install-web:
	pnpm install --frozen-lockfile

py-dev: install-py
	cd apps/agent-py && uv run ares-agent-api

py-test: install-py
	cd apps/agent-py && uv run ruff check src tests && uv run mypy src && uv run pytest -q

py-build: install-py
	cd apps/agent-py && uv build

web-dev: install-web
	pnpm --filter @asst/web dev
