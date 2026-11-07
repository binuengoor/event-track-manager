# === Stage 0: CSS (standalone Tailwind CLI, no Node) ===
FROM debian:bookworm-slim AS css
ARG TARGETARCH
ARG TAILWIND_VERSION=3.4.17
ARG TAILWIND_SHA256_AMD64=7d24f7fa191d2193b78cd5f5a42a6093e14409521908529f42d80b11fde1f1d4
ARG TAILWIND_SHA256_ARM64=69b1378b8133192d7d2feb12a116fa12d035594f58db3eff215879e4ad8cf39b
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*
RUN set -eu; \
    case "${TARGETARCH:-amd64}" in \
      amd64) asset=tailwindcss-linux-x64;   sha="${TAILWIND_SHA256_AMD64}" ;; \
      arm64) asset=tailwindcss-linux-arm64; sha="${TAILWIND_SHA256_ARM64}" ;; \
      *) echo "unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fsSL --retry 3 -o /usr/local/bin/tailwindcss \
      "https://github.com/tailwindlabs/tailwindcss/releases/download/v${TAILWIND_VERSION}/${asset}"; \
    echo "${sha}  /usr/local/bin/tailwindcss" | sha256sum -c -; \
    chmod +x /usr/local/bin/tailwindcss
WORKDIR /src
COPY app/tailwind.config.js app/tailwind.config.js
COPY app/static app/static
RUN tailwindcss -c app/tailwind.config.js -i app/static/css/tailwind.input.css \
      -o /out/app.css --minify

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
COPY --from=css /out/app.css app/static/css/app.css
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
