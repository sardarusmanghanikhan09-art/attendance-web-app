# Express API + Python face daemon (server.js spawns face_service.py on 127.0.0.1:5001)
# Listens on 7860 (Caddy proxies to it) and runs as the non-root "node" user
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-venv python3-dev build-essential libglib2.0-0 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

USER node
ENV HOME=/home/node PATH="/home/node/venv/bin:$PATH"
WORKDIR /home/node/app

# insightface ships no wheel, so build it against an already-installed numpy/cython
RUN python3 -m venv /home/node/venv \
    && pip install --no-cache-dir numpy cython opencv-python-headless onnxruntime \
    && pip install --no-cache-dir --no-build-isolation insightface

# Bake the buffalo_l face model (~300 MB) into the image so scans work right after a restart
RUN python3 -c "from insightface.app import FaceAnalysis; FaceAnalysis(name='buffalo_l', allowed_modules=['detection', 'recognition'], providers=['CPUExecutionProvider'])"

COPY --chown=node package*.json ./
RUN npm ci --omit=dev
COPY --chown=node . .

ENV NODE_ENV=production PORT=7860
EXPOSE 7860
CMD ["node", "server.js"]
