ARG NODE_IMAGE=node:22-alpine
ARG PYTHON_IMAGE=python:3.13-slim

FROM ${NODE_IMAGE} AS frontend-build

ARG NPM_REGISTRY=https://registry.npmjs.org
ARG VITE_TIANDITU_TOKEN=
ENV VITE_TIANDITU_TOKEN=$VITE_TIANDITU_TOKEN
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm config set registry "$NPM_REGISTRY" \
    && npm config set fetch-retries 5 \
    && npm config set fetch-retry-mintimeout 20000 \
    && npm config set fetch-retry-maxtimeout 120000 \
    && npm ci --prefer-offline --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM ${PYTHON_IMAGE} AS runtime

ARG PIP_INDEX_URL=https://pypi.org/simple
ARG PIP_TRUSTED_HOST=
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    FRONTEND_DIST_DIR=/app/frontend-dist \
    PORT=8000

WORKDIR /app/backend
COPY backend/requirements.txt ./requirements.txt
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --index-url "$PIP_INDEX_URL" ${PIP_TRUSTED_HOST:+--trusted-host "$PIP_TRUSTED_HOST"} --upgrade pip \
    && pip install --index-url "$PIP_INDEX_URL" ${PIP_TRUSTED_HOST:+--trusted-host "$PIP_TRUSTED_HOST"} -r requirements.txt

COPY backend/app ./app
COPY --from=frontend-build /build/frontend/dist /app/frontend-dist

RUN useradd --create-home --uid 10001 ocean \
    && mkdir -p /app/.runtime /app/backend/.cache \
    && chown -R ocean:ocean /app

USER ocean
EXPOSE 8000
HEALTHCHECK --interval=20s --timeout=8s --start-period=45s --retries=6 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=5)"

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
