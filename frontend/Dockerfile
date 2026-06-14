# HydroMind React dashboard — multi-stage build.
# Build context MUST be the repo root so the nginx config in infra/ can be
# copied in. See infra/docker-compose.yml.

# ── Stage 1: build the Vite bundle ────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ── Stage 2: serve static assets via nginx ────────────────────────────────────
FROM nginx:alpine
# SPA + reverse-proxy config (proxies /readings, /ws, etc. to the backend).
COPY infra/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
