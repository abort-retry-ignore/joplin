FROM node:20-alpine

WORKDIR /app

COPY packages/app-web/package.json ./package.json
RUN npm install --omit=dev

COPY packages/app-web/app ./app
COPY packages/app-web/server.js ./server.js
COPY packages/app-web/public ./public

EXPOSE 3001

CMD ["node", "server.js"]
