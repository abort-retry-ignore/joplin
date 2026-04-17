FROM node:20-alpine

WORKDIR /app

COPY packages/app-web/package.json ./package.json
COPY packages/app-web/server.js ./server.js
COPY packages/app-web/public ./public

EXPOSE 3001

CMD ["node", "server.js"]
