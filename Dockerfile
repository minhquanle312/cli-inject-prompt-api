FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3322 \
    PATH=/root/.local/bin:$PATH

RUN apk add --no-cache bash curl tar coreutils \
    && curl -fsSL https://antigravity.google/cli/install.sh | bash \
    && npm i -g command-code@latest

COPY package*.json ./
COPY --from=builder /app/dist ./dist

EXPOSE 3322
CMD ["node", "dist/src/index.js"]
