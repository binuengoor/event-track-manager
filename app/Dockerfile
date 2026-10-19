# === Stage 1: Builder ===
FROM python:3.11.9-slim AS builder
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libffi-dev && rm -rf /var/lib/apt/lists/*
COPY app/requirements.txt requirements.txt
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# === Stage 2: Runtime ===
FROM python:3.11.9-slim AS runtime
ENV PYTHONUNBUFFERED=1 \
    DEBIAN_FRONTEND=noninteractive \
    RUNTIME_ENV=docker

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        curl \
        ffmpeg \
        ca-certificates \
        gosu \
        tini && \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder /install /usr/local
COPY app app
COPY config.yaml .
COPY app/docker-entrypoint.sh /docker-entrypoint.sh

RUN useradd -r -u 1000 -s /bin/false appuser && \
    mkdir -p /data/cache /events /app/data && \
    chmod +x /docker-entrypoint.sh && \
    chown -R appuser:appuser /app /data /events


EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/api/health || exit 1

ENTRYPOINT ["tini", "--", "/docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
