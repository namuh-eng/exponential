FROM node:20-alpine AS deps
RUN npm install --global bun@1.3.14
WORKDIR /workspace
COPY package.json bun.lock turbo.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/cli/package.json apps/cli/package.json
COPY apps/mcp/package.json apps/mcp/package.json
COPY apps/zapier/package.json apps/zapier/package.json
COPY packages/sdk/package.json packages/sdk/package.json
COPY packages/proto/package.json packages/proto/package.json
COPY packages/mcp-server/package.json packages/mcp-server/package.json
RUN bun install --frozen-lockfile

FROM node:20-alpine AS builder
RUN npm install --global bun@1.3.14
WORKDIR /workspace
ARG NEXT_PUBLIC_EXPONENTIAL_VERSION=version:unknown
ARG NEXT_PUBLIC_EXPONENTIAL_GIT_BRANCH=branch:unknown
ARG NEXT_PUBLIC_EXPONENTIAL_GIT_SHA=sha:unknown
ARG NEXT_PUBLIC_EXPONENTIAL_GITHUB_URL=""
ENV NEXT_PUBLIC_EXPONENTIAL_VERSION=$NEXT_PUBLIC_EXPONENTIAL_VERSION
ENV NEXT_PUBLIC_EXPONENTIAL_GIT_BRANCH=$NEXT_PUBLIC_EXPONENTIAL_GIT_BRANCH
ENV NEXT_PUBLIC_EXPONENTIAL_GIT_SHA=$NEXT_PUBLIC_EXPONENTIAL_GIT_SHA
ENV NEXT_PUBLIC_EXPONENTIAL_GITHUB_URL=$NEXT_PUBLIC_EXPONENTIAL_GITHUB_URL
COPY --from=deps /workspace/node_modules ./node_modules
COPY --from=deps /workspace/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /workspace/packages/sdk/node_modules ./packages/sdk/node_modules
COPY . .
RUN bun run --filter @namuh-eng/expn-sdk build && bun run --filter @exponential/web build

FROM node:20-alpine AS runner
WORKDIR /workspace
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /workspace/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /workspace/apps/web/.next/static ./apps/web/.next/static
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["node", "apps/web/server.js"]
