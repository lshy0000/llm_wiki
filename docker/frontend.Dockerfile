FROM node:22-bookworm-slim AS build

WORKDIR /app

ENV TZ=Asia/Shanghai

COPY package.json package-lock.json tsconfig.json ./
COPY frontend/package.json ./frontend/package.json
COPY backend/package.json ./backend/package.json

RUN npm ci --workspace @llm-wiki/frontend --include-workspace-root=false --include=dev \
    && npm cache clean --force

COPY frontend ./frontend

RUN npm run build -w @llm-wiki/frontend

FROM nginx:1.27-alpine AS runtime

COPY docker/nginx/nginx.conf /etc/nginx/nginx.conf
COPY docker/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
