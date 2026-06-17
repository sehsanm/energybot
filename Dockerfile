FROM node:20-alpine AS admin-build
WORKDIR /admin
COPY admin_ui/package.json admin_ui/package-lock.json* ./
RUN npm install
COPY admin_ui/ ./
RUN npm run build

FROM python:3.12-slim AS runtime
ARG APT_MIRROR=
RUN if [ -n "$APT_MIRROR" ]; then sed -i "s|http://deb.debian.org|http://$APT_MIRROR|g" /etc/apt/sources.list.d/debian.sources; fi \
 && apt-get -o Acquire::Check-Valid-Until=false update && apt-get install -y --no-install-recommends libmagic1 libzbar0 ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY pyproject.toml ./
COPY alembic.ini ./
COPY alembic ./alembic
COPY src ./src
RUN pip install --no-cache-dir -e .
COPY --from=admin-build /admin/out ./admin_ui/out
ENV ENERGYBOT_ADMIN_STATIC_DIR=/app/admin_ui/out
ENV MEDIA_ROOT=/var/lib/energybot/media
RUN mkdir -p $MEDIA_ROOT
EXPOSE 8000
CMD ["uvicorn", "energybot.main:app", "--host", "0.0.0.0", "--port", "8000"]
