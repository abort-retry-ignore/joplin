FROM node:20-bookworm AS builder

WORKDIR /app

COPY . .

RUN corepack enable
RUN yarn install --mode=skip-build
RUN yarn workspace @joplin/htmlpack tsc
RUN yarn workspace @joplin/lib tsc
RUN yarn workspace @joplin/app-mobile tsc
RUN yarn workspace @joplin/app-mobile web

FROM node:20-alpine AS runner

WORKDIR /srv/joplin-mobile-web

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

COPY --from=builder /app/packages/app-mobile/web/dist ./public
COPY packages/app-mobile/docker-web/server.js ./server.js

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget --quiet --tries=1 --spider http://127.0.0.1:3000/health || exit 1

CMD ["node", "server.js"]
