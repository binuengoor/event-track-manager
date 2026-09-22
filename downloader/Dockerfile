# === Stage 1: Builder ===
FROM python:3.11.9-slim AS builder
WORKDIR /build
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# === Stage 2: Runtime ===
FROM python:3.11.9-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    DEBIAN_FRONTEND=noninteractive \
    DENO_VERSION=v2.2.3

WORKDIR /app

# Install system dependencies: ffmpeg for media transcoding, curl, ca-certificates, tini
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ffmpeg \
        curl \
        ca-certificates \
        tini && \
    ARCH=$(uname -m) && \
    if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then \
        DENO_ARCH="aarch64-unknown-linux-gnu"; \
    else \
        DENO_ARCH="x86_64-unknown-linux-gnu"; \
    fi && \
    curl -fsSL "https://github.com/denoland/deno/releases/download/${DENO_VERSION}/deno-${DENO_ARCH}.zip" -o /tmp/deno.zip && \
    python3 -c "import zipfile; zipfile.ZipFile('/tmp/deno.zip').extractall('/usr/local/bin')" && \
    rm /tmp/deno.zip && \
    chmod +x /usr/local/bin/deno && \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder /install /usr/local
COPY main.py .

RUN useradd -r -u 1000 -s /bin/false appuser && \
    mkdir -p /data/cache /tmp && \
    chown -R appuser:appuser /app /data /tmp

USER appuser

EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8001/health || exit 1

ENTRYPOINT ["tini", "--"]
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
