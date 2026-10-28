# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1 \
    CI=1
RUN corepack enable
WORKDIR /app

FROM base AS web-build
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ARG NEXT_PUBLIC_SOURCE_URL=https://github.com/openscroll/openscroll
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_SOURCE_URL=$NEXT_PUBLIC_SOURCE_URL
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @openscroll/web build

FROM node:22-bookworm-slim AS web
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs openscroll
COPY --from=web-build --chown=openscroll:nodejs /app/apps/web/.next/standalone/ ./
COPY --from=web-build --chown=openscroll:nodejs /app/apps/web/.next/static ./apps/web/.next/static
USER openscroll
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

FROM base AS worker
ENV NODE_ENV=production \
    HOME=/home/openscroll
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs --create-home openscroll
COPY . .
RUN pnpm install --frozen-lockfile \
    && chown -R openscroll:nodejs /app
USER openscroll
CMD ["pnpm", "worker:watch"]
