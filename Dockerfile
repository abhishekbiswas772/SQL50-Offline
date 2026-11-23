# syntax=docker/dockerfile:1.7

FROM python:3.12-slim AS builder

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    VENV=/opt/venv

RUN python -m venv "$VENV"
ENV PATH="$VENV/bin:$PATH"

WORKDIR /build
COPY requirements.txt ./
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --upgrade pip && \
    pip install -r requirements.txt

FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH" \
    SQL50_PORT=8000 \
    SQL50_NO_BROWSER=1 \
    SQL50_PSQL=/usr/bin/psql

# app/db.py shells out to psql, so the client binary must exist in the image.
RUN apt-get update && \
    apt-get install -y --no-install-recommends postgresql-client && \
    rm -rf /var/lib/apt/lists/* && \
    useradd --uid 10001 --user-group --create-home --shell /usr/sbin/nologin appuser

WORKDIR /app

COPY --from=builder /opt/venv /opt/venv
COPY --chown=10001:10001 app ./app
COPY --chown=10001:10001 data ./data

USER 10001

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/', timeout=2).status == 200 else 1)"

CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port \"${SQL50_PORT}\""]

FROM runtime AS test

USER root
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY requirements.txt requirements-dev.txt ./
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -r requirements-dev.txt && \
    apt-get update && apt-get install -y --no-install-recommends libatomic1 && \
    playwright install --with-deps chromium && \
    rm -rf /var/lib/apt/lists/* && \
    chmod -R a+rX /ms-playwright

COPY --chown=10001:10001 tests ./tests
COPY --chown=10001:10001 server.py ./

USER 10001
CMD ["python", "tests/test_ui.py"]

# Last stage = default target, so a plain `docker build` gives the app image, not the test one.
FROM runtime AS app
