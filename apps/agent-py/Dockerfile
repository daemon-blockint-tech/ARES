FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY pyproject.toml README.md ./
COPY src ./src
COPY migrations ./migrations
COPY scripts ./scripts
RUN pip install --no-cache-dir uv && uv pip install --system -e .
ENV PYTHONPATH=/app/src
EXPOSE 8765
CMD ["uvicorn", "ares_plugin.api.main:app", "--host", "0.0.0.0", "--port", "8765"]
