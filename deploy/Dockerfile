FROM node:24.21.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY apps ./apps
COPY packages ./packages
COPY registry ./registry
COPY scripts ./scripts
COPY tests ./tests
RUN npm run build

FROM node:24.21.0-bookworm-slim AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:24.21.0-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PORT=3030
WORKDIR /app
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=production-dependencies --chown=node:node /app/package.json ./package.json
COPY --chown=node:node LICENSE BRANDING.md THIRD_PARTY_NOTICES.md ./
COPY --chown=node:node third-party-licenses ./third-party-licenses
COPY --from=build --chown=node:node /app/work/build/apps ./work/build/apps
COPY --from=build --chown=node:node /app/work/build/packages ./work/build/packages
COPY --from=build --chown=node:node /app/work/build/scripts ./work/build/scripts
COPY --chown=node:node apps/console/public ./apps/console/public
COPY --chown=node:node playbooks ./playbooks
COPY --chown=node:node registry ./registry
COPY --chown=node:node deploy/metadata/README.md ./config/metadata/README.md
COPY --chown=node:node deploy/healthcheck.mjs ./deploy/healthcheck.mjs
COPY --chown=node:node packages/storage/migrations ./packages/storage/migrations
RUN mkdir -p /app/work/artifacts /app/work/autotask-config /app/work/diagnostics && chown node:node /app/work/artifacts /app/work/autotask-config /app/work/diagnostics && chmod 700 /app/work/autotask-config /app/work/diagnostics
USER node
EXPOSE 3030
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["node", "deploy/healthcheck.mjs"]
CMD ["node", "work/build/apps/server/src/main.js"]
