# syntax=docker/dockerfile:1.7
#
# Thin runtime-only image. The webpack bundle must be pre-built on the host
# by running build.sh (which calls tsc + webpack before docker compose up).

FROM node:20-alpine

WORKDIR /srv/joplin-mobile-web

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

# Pre-built by build.sh — only these two paths are needed at runtime.
COPY packages/app-mobile/web/dist ./public
COPY packages/app-mobile/docker-web/server.js ./server.js

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:3000/health || exit 1

CMD ["node", "server.js"]
