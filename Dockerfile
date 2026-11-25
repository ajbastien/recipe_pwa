# syntax=docker/dockerfile:1
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production
ENV PORT=3000
ENV NODE_OPTIONS=--experimental-sqlite
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json server.js ./
COPY src ./src
COPY public ./public
RUN mkdir -p data/images && chown -R app:app data
USER app
EXPOSE 3000
CMD ["node", "server.js"]
