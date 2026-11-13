# syntax=docker/dockerfile:1
# One image definition for every service. Pick the service with the SERVICE
# build argument (docker-compose passes it; on Railway set a SERVICE variable):
#
#   authentication | user | property | chat | payment | notification | api-gateway
#
#   docker build --build-arg SERVICE=property -t tilomnov-property .

# --- Shared build: dependencies, Prisma client and shared library ---
# No service source here: editing chat must not invalidate another service's build.
FROM node:22-alpine AS shared-builder
WORKDIR /app

# Dependency manifests first, so `npm ci` is cached until a package.json changes.
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY authentication/package.json authentication/
COPY user/package.json user/
COPY property/package.json property/
COPY chat/package.json chat/
COPY payment/package.json payment/
COPY notification/package.json notification/
COPY api-gateway/package.json api-gateway/
# Retries ride out a dropped connection to the npm registry (ECONNRESET).
RUN npm ci --prefer-offline --no-audit --no-fund \
    --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000

COPY prisma/schema.prisma ./prisma/schema.prisma
COPY prisma.config.ts ./
RUN npx prisma generate

COPY shared ./shared
RUN npm run build --workspace=shared

# --- Service build: only this service's source and compiled output ---
FROM shared-builder AS broker-bootstrap
COPY scripts/security/provision-rabbitmq.cjs ./scripts/security/
ENTRYPOINT ["node", "scripts/security/provision-rabbitmq.cjs", "--apply"]

FROM shared-builder AS builder
ARG SERVICE
ARG RAILWAY_SERVICE_NAME
ENV SERVICE=${SERVICE:-$RAILWAY_SERVICE_NAME}
RUN test -n "$SERVICE" || (echo "Set SERVICE or RAILWAY_SERVICE_NAME to the service to build." >&2 && exit 1)
COPY ${SERVICE}/ ./${SERVICE}/
RUN npm run build --workspace=$SERVICE

# --- Runtime stage: production dependencies and one service's compiled output ---
FROM node:22-alpine
ARG SERVICE
# On Railway the service name is the fallback, so a service named "chat" builds chat.
ARG RAILWAY_SERVICE_NAME
ENV NODE_ENV=production SERVICE=${SERVICE:-$RAILWAY_SERVICE_NAME}
RUN test -n "$SERVICE" || (echo "Set the SERVICE variable (authentication, user, property, chat, payment, notification or api-gateway)." >&2 && exit 1)
WORKDIR /app

# Every manifest, because the lockfile describes all workspaces; only this
# service's (and shared's) dependencies are installed.
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY authentication/package.json authentication/
COPY user/package.json user/
COPY property/package.json property/
COPY chat/package.json chat/
COPY payment/package.json payment/
COPY notification/package.json notification/
COPY api-gateway/package.json api-gateway/
RUN npm ci --omit=dev --include-workspace-root --workspace=shared --workspace=$SERVICE \
    --prefer-offline --no-audit --no-fund \
    --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000

# Reuse the client generated for the same Alpine platform instead of generating it seven times.
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY --from=shared-builder /app/node_modules/@tilomnov/prisma-client ./node_modules/@tilomnov/prisma-client

COPY --from=shared-builder /app/shared/dist ./shared/dist
# Subpath entry points: error reporting (imported by each main.ts before anything
# else) and API versions (also used by the gateway, which has no database client).
COPY shared/sentry.js shared/sentry.d.ts shared/api-versions.js shared/api-versions.d.ts ./shared/
COPY --from=builder /app/$SERVICE/dist ./$SERVICE/dist
# Never run as root. Nothing under /app is written to at runtime, so root-owned files are fine.
USER node

# Each service listens on PORT (Railway sets it); the defaults are in each main.ts.
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-4000}/health" || exit 1

CMD ["sh", "-c", "exec node ${SERVICE}/dist/main.js"]
