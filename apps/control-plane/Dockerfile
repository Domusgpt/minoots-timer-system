# syntax=docker/dockerfile:1

FROM node:20-bullseye-slim AS builder
WORKDIR /app

COPY package.json tsconfig.json ./
COPY src ./src
RUN npm install && npm run build

FROM node:20-bullseye-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist

EXPOSE 4000
CMD ["node", "dist/server.js"]
