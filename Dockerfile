# Root Dockerfile kept for existing deploy tooling; builds the web app image
# ONLY. This is NOT what `docker compose up` or the ECS deploy use — those
# build infra/docker/web.Dockerfile and infra/docker/api.Dockerfile. Do not
# use `docker build .` from the repo root expecting a runnable full stack.
FROM node:20-alpine AS deps
RUN corepack enable
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

FROM node:20-alpine AS builder
RUN corepack enable
WORKDIR /workspace
COPY --from=deps /workspace/node_modules ./node_modules
COPY --from=deps /workspace/apps/web/node_modules ./apps/web/node_modules
COPY . .
RUN pnpm --filter @exponential/web build

FROM node:20-alpine AS runner
WORKDIR /workspace/apps/web
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /workspace/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /workspace/apps/web/.next/static ./.next/static
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]
