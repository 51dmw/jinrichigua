# Strapi 5 生产镜像（§7：Strapi + PostgreSQL 跑在 VPS，Docker 部署）。
# 构建上下文 = 仓库根目录： docker build -f apps/cms/Dockerfile -t newsportal-cms .
# syntax=docker/dockerfile:1

# ───────── 构建阶段 ─────────
FROM node:20-bookworm-slim AS builder
ENV NODE_ENV=production
# sharp / 图片处理依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential python3 libvips-dev \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

# 先拷贝清单以利用缓存（拷贝全部 workspace 清单以满足 frozen-lockfile）
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/web/package.json ./apps/web/
COPY apps/cms/package.json ./apps/cms/
# NODE_ENV=production 会让 pnpm 跳过 devDependencies，但构建需要
# @strapi/typescript-utils + typescript（devDeps），故 --prod=false 强制装上。
RUN pnpm install --frozen-lockfile --filter cms --prod=false

# 拷贝源码并构建 admin
COPY apps/cms ./apps/cms
WORKDIR /app/apps/cms
# 先生成 content-type 类型（types/generated/），否则 strapi build 的 tsc 编译
# 不认识 reviewState/word 等自定义字段而报错。该步骤不连 DB、不需密钥。
RUN pnpm exec strapi ts:generate-types && pnpm build

# ───────── 运行阶段 ─────────
FROM node:20-bookworm-slim AS runner
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends libvips42 \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app
# 直接带上已装好的 node_modules 与构建产物
COPY --from=builder /app ./
WORKDIR /app/apps/cms

EXPOSE 1337
# 媒体上传目录建议挂卷： -v cms_uploads:/app/apps/cms/public/uploads
CMD ["pnpm", "start"]
