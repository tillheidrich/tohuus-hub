# syntax=docker/dockerfile:1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e
# Base image pinned to a digest (SECURITY.md, review 18.10.2026 P1-3): node:22-bookworm-slim as of 18.10.2026.
# Update monthly (G4): curl the registry for the current digest of the tag and replace both lines.
FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data TZ=Europe/Berlin
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils tini curl ca-certificates fonts-dejavu-core \
  tesseract-ocr tesseract-ocr-deu tesseract-ocr-eng \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# demo recipe photos (copied into the image store when the demo is seeded)
COPY --from=build /app/server/assets ./server/assets
COPY package.json ./
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD curl -fs "http://localhost:${PORT:-8080}/health" || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/server.mjs"]
