# Express API + Python face daemon (server.js spawns face_service.py on 127.0.0.1:5001)
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-venv python3-dev build-essential libglib2.0-0 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# insightface has no prebuilt ARM wheel, so build it against an already-installed numpy/cython
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip install --no-cache-dir numpy cython opencv-python-headless onnxruntime \
    && pip install --no-cache-dir --no-build-isolation insightface

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

ENV NODE_ENV=production PORT=5000
EXPOSE 5000
CMD ["node", "server.js"]
