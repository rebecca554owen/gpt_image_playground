#!/usr/bin/env bash
set -Eeuo pipefail

docker run --rm --pull=always \
  -v "$PWD:/app" \
  -v /app/node_modules \
  -v /app/dist \
  -w /app \
  node:24-alpine \
  sh -lc 'npm ci && npm run build && npm test'
