FROM node:22-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    TZ=Asia/Shanghai

COPY package.json package-lock.json tsconfig.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json

RUN npm ci --workspace @llm-wiki/backend --include-workspace-root=false --omit=dev \
    && npm cache clean --force

COPY backend ./backend

WORKDIR /app/backend
EXPOSE 8787

CMD ["npm", "run", "dev"]
