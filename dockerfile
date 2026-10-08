FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim
WORKDIR /srv/api
COPY api/pyproject.toml ./
COPY api/app ./app
RUN uv sync --no-dev
COPY --from=web /web/dist /srv/web/dist
ENV DATA_DIR=/data
EXPOSE 80
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "80"]
