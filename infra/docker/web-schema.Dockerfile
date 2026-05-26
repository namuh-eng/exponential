FROM node:20-alpine
RUN corepack enable
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/cli/package.json apps/cli/package.json
COPY packages/sdk/package.json packages/sdk/package.json
COPY packages/proto/package.json packages/proto/package.json
RUN pnpm install --frozen-lockfile
COPY apps/web ./apps/web
WORKDIR /workspace/apps/web
CMD ["pnpm", "exec", "drizzle-kit", "push", "--config", "drizzle.config.ts", "--force"]
