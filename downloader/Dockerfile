FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    DEBIAN_FRONTEND=noninteractive

WORKDIR /app

# Install system dependencies: ffmpeg for audio transcoding, curl, unzip & ca-certificates, and install Deno
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ffmpeg \
        curl \
        unzip \
        ca-certificates && \
    ARCH=$(uname -m) && \
    if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then \
        DENO_ARCH="aarch64-unknown-linux-gnu"; \
    else \
        DENO_ARCH="x86_64-unknown-linux-gnu"; \
    fi && \
    curl -fsSL "https://github.com/denoland/deno/releases/latest/download/deno-${DENO_ARCH}.zip" -o /tmp/deno.zip && \
    unzip /tmp/deno.zip -d /usr/local/bin && \
    rm /tmp/deno.zip && \
    chmod +x /usr/local/bin/deno && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8001/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
