FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim AS runner

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3322 \
    PATH=/root/.local/bin:$PATH

RUN apt-get update \
    && apt-get install -y --no-install-recommends bash curl ca-certificates tar coreutils wget \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL https://antigravity.google/cli/install.sh | bash \
    && npm i -g command-code@latest

COPY package*.json ./
COPY --from=builder /app/dist ./dist

EXPOSE 3322
CMD ["node", "dist/src/index.js"]
