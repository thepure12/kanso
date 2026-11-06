# syntax=docker/dockerfile:1

# ---------------------------------------------------------------- base
FROM node:22-alpine AS base
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# pnpm version comes from package.json's packageManager field.
COPY package.json ./
RUN corepack enable && corepack install

# ---------------------------------------------------------------- build
FROM base AS build
# Download packages from the lockfile alone, so this layer survives source edits.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
COPY . .
# Sub-path deployments (https://host/kanso/): --build-arg NUXT_APP_BASE_URL=/kanso/
ARG NUXT_APP_BASE_URL=/
ENV NUXT_APP_BASE_URL=$NUXT_APP_BASE_URL
RUN pnpm install --frozen-lockfile --offline && pnpm build

# ---------------------------------------------------------------- migrate
# One-off: drizzle-kit migrate as kanban_owner (MIGRATION_DATABASE_URL).
FROM build AS migrate
CMD ["pnpm", "db:migrate"]

# ---------------------------------------------------------------- runtime
# .output is self-contained (Nitro bundles its dependencies).
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/.output ./.output
USER node
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
