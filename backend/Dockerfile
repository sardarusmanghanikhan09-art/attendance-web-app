# Express API only. Face recognition runs on the user's device (frontend/src/face), so no Python here.
# Listens on 7860 (Caddy proxies to it) and runs as the non-root "node" user. Fits comfortably in 1 GB RAM.
FROM node:20-bookworm-slim

USER node
WORKDIR /home/node/app

COPY --chown=node package*.json ./
RUN npm ci --omit=dev
COPY --chown=node . .

ENV NODE_ENV=production PORT=7860
EXPOSE 7860
# Cap the V8 heap so the API stays well inside a 1 GB VM
CMD ["node", "--max-old-space-size=512", "server.js"]
