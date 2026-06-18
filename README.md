# 新闻门户复刻 · Monorepo（M1 脚手架）

移动优先的多频道内容门户。前后端解耦：**Strapi 5（CMS）** + **Next.js 15（前台）**，
SEO 面向 **Google + Yandex**。所有开发遵守 [`DEVELOPMENT_CONSTRAINTS.md`](./DEVELOPMENT_CONSTRAINTS.md)（强约束）。

> 模板仅参考 i.ifeng.com 移动版的**版式结构**，**未**抓取/复制其任何文本、图片或数据。

---

## 目录结构

```
/apps
  /cms      # Strapi 5（PostgreSQL）→ 部署到 VPS
  /web      # Next.js 15 App Router + TS + Tailwind → 部署到 Cloudflare Workers (OpenNext, M5)
/packages
  /shared   # 前后台共享 TS 类型（单一事实来源）
pnpm-workspace.yaml
```

数据流单向：**写入只经 Strapi**；前台只读「已发布」内容并静态化（SSG + ISR）。前台 **不直连数据库**。

---

## 技术栈（版本锁定见各 `package.json`）

| 层 | 选型 |
|---|---|
| CMS | Strapi 5.x（v5 用 `documentId`） |
| 数据库 | PostgreSQL 16+（生产禁用 SQLite） |
| 前台 | Next.js 15 · App Router · TypeScript · Tailwind |
| 运行时 | Node.js 20 LTS+ |
| 包管理 | pnpm（workspaces 单仓多包） |

---

## 快速开始

### 0. 先决条件
- Node.js 20 LTS+，pnpm 9+
- 一个可连接的 **PostgreSQL 16+** 实例（建库 `newsportal`）

```bash
# 本地起一个 postgres（示例，可换成你自己的实例）
docker run -d --name newsportal-pg -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=newsportal -p 5432:5432 postgres:16
```

### 1. 安装依赖（根目录一键）
```bash
pnpm install
```

### 2. 配置环境变量
```bash
cp .env.example .env
cp apps/cms/.env.example apps/cms/.env        # 填 DB 连接 + 随机密钥
cp apps/web/.env.example apps/web/.env.local  # 填 SITE_URL / STRAPI_API_URL
```
生成 Strapi 密钥：`openssl rand -base64 32`（逐项替换 `apps/cms/.env`）。
**MUST NOT** 提交任何 `.env`。

### 3. 启动

```bash
# 先编译共享类型包
pnpm --filter shared build

# 后台（http://localhost:1337/admin，首次注册管理员账号）
pnpm dev:cms

# 前台（http://localhost:3000）
pnpm dev:web
```

> CMS 首次启动会自动：① 给 public 角色开放只读权限；② 写入示例频道/文章/Global。
> 因此前台启动后首页/频道页/文章页立即有内容可看。

也可并行起两端：`pnpm dev`。

---

## M1 交付范围（Definition of Done）

- [x] `pnpm install` 根目录一键装好 `web` + `cms`
- [x] Strapi 5 连 PostgreSQL，建好 **Channel / Article / Tag / AdSlot** + **seo 组件** + **Global**，装 `@strapi/plugin-seo`
- [x] Next 15 取 Strapi 数据，渲染 **首页(模块化) / 频道页 / 文章页**
- [x] 文章页 `generateMetadata` + `NewsArticle` JSON-LD（走回退链）+ `BreadcrumbList`
- [x] `/sitemap.xml`、`/news-sitemap.xml`、`/robots.txt` 可访问
- [x] `.env.example`、`README`、约束文档入库

### 关键实现位置

| 约束 | 文件 |
|---|---|
| 共享类型（单一事实来源） | [`packages/shared/src/index.ts`](packages/shared/src/index.ts) |
| 内容模型 | `apps/cms/src/api/*/content-types/*/schema.json` |
| SEO 组件 | `apps/cms/src/components/seo/*.json` |
| 首次权限 + 示例数据 | [`apps/cms/src/index.ts`](apps/cms/src/index.ts) |
| 取数层（只读已发布） | [`apps/web/lib/strapi.ts`](apps/web/lib/strapi.ts) |
| SEO 回退链 + JSON-LD | [`apps/web/lib/seo.ts`](apps/web/lib/seo.ts) |
| 首页模块化 | [`apps/web/app/page.tsx`](apps/web/app/page.tsx) + `components/HomeBlockSection.tsx` |
| 文章页 | [`apps/web/app/[channelSlug]/[articleSlug]/page.tsx`](apps/web/app/[channelSlug]/[articleSlug]/page.tsx) |
| sitemap（分层索引）/ news-sitemap / robots | `apps/web/app/sitemap.xml/route.ts`(索引) + `app/sitemaps/*.xml`(频道/标签/作者/文章分片) + `app/news-sitemap.xml/route.ts` + `app/robots.ts`；工具 `lib/sitemap.ts` |
| 按需 ISR webhook（token 保护） | [`apps/web/app/api/revalidate/route.ts`](apps/web/app/api/revalidate/route.ts) |
| 发布联动（lifecycle） | [`apps/cms/src/api/article/content-types/article/lifecycles.ts`](apps/cms/src/api/article/content-types/article/lifecycles.ts) |

---

## 常用脚本

```bash
pnpm dev            # 并行起 web + cms
pnpm dev:cms        # 仅 Strapi
pnpm dev:web        # 仅 Next
pnpm build          # shared → cms → web 顺序构建
pnpm --filter web typecheck
pnpm --filter web lint
```

---

## M2 后台内容安全（已实现）

§6 内容安全约束落地。**后台 admin UI 是审核主路径**；内容 API 同样受门禁保护。

| 能力 | 实现 | 说明 |
|---|---|---|
| RBAC 三角色 | [`apps/cms/src/index.ts`](apps/cms/src/index.ts) `ensureAdminRoles` | 管理员=内置 Super Admin；启动自动建「编辑」「审核」后台角色。**编辑无 publish 权**，**审核可发布** |
| 三态审核流 | `reviewState` 字段 + [`controllers/article.ts`](apps/cms/src/api/article/controllers/article.ts) | `草稿→待审(submit)→已发布(approve)`；`reject` 退回带意见 |
| 发布守卫 | `index.ts` `registerPublishGuard` | document 中间件：`reviewState!=approved` 一律禁止 publish（admin UI / API / cron 全生效） |
| API 不越权发布 | `article.ts` 覆写 `create` | 内容 API 创建强制为草稿，发布只能经 `approve` |
| 敏感词过滤 | [`api/sensitive-word`](apps/cms/src/api/sensitive-word) + [`lifecycles.ts`](apps/cms/src/api/article/content-types/article/lifecycles.ts) | 写入前扫描 标题+正文，命中即拦截（400）；词库后台可维护，含内置兜底 |
| 定时发布 | [`config/server.ts`](apps/cms/config/server.ts) cron | 每分钟把「approved 且 publishAt 到点」的草稿自动发布 |
| 媒体库 | Strapi 内置 Media Library | R2 provider 已在 `config/plugins.ts` 留好（M5 启用） |

**审核流自定义接口**（`config/policies` 控权，或用 API Token）：
```
POST /api/articles/:id/submit    # 编辑提交待审
POST /api/articles/:id/approve   # 审核通过并发布   body: {"note":"..."}
POST /api/articles/:id/reject    # 审核退回         body: {"note":"..."}
```

**端到端验证**（已实测全过）：编辑创建草稿→发布前公开 API 不可见(0)→submit→approve→公开可见(1)；
含「敏感词测试」的提交被 400 拦截；approved+过期 publishAt 的草稿被 cron 在下一分钟自动发布。

> 开发便利：`apps/cms/.env` 设 `SEED_DEV_TOKEN=true` 时，首启会创建一个 full-access API Token 并打印到日志（**生产务必删除**）。

---

## M3 前台打磨（已实现）

§5 前台渲染约束深化。

| 能力 | 实现 | 验证 |
|---|---|---|
| 首页编排内容类型化 | 单类型 [`home-page`](apps/cms/src/api/home-page) + 组件 [`layout.home-block`](apps/cms/src/components/layout/home-block.json)；前台 [`getHomeBlocks`](apps/web/lib/strapi.ts) 优先读编排，空则回退频道自动生成 | 区块顺序/标题/variant/取数量全由后台配置，**前台零硬编码栏目** |
| 卡片 variant 打磨 | [`ArticleCard`](apps/web/components/ArticleCard.tsx) + [`HomeBlockSection`](apps/web/components/HomeBlockSection.tsx) | hero(大图) / left-text-right-image(左文右图) / **three-image(三列图网格)** / text-only(纯文字) 四版式各异 |
| 频道分页 | [`[channelSlug]/page.tsx`](apps/web/app/[channelSlug]/page.tsx) `?page=N` | 上/下一页控件、页码、越界 404；实测 /sports 24 篇分 2 页 |
| 相关推荐 | [`getRelatedArticles`](apps/web/lib/strapi.ts) + 文章页 aside | 同频道、排除当前，实测 6 条 |
| 按需 ISR 联调 | Strapi lifecycle → 前台 [`/api/revalidate`](apps/web/app/api/revalidate/route.ts)（标签级失效） | 实测发布/审核触发 webhook，revalidate 计数随发布递增，无失败 |

> 首页编排在 Strapi 启动时按现有频道自动生成默认配置（`ensureHomeLayout`），可在后台「HomePage」单类型里随意增删/排序区块、切换 variant，前台即时反映。

---

## M4 SEO 收录优化（已实现）

§4 Google + Yandex 双引擎收录。

| 能力 | 实现 | 验证 |
|---|---|---|
| IndexNow 自动推送 | [`lib/indexnow.ts`](apps/web/lib/indexnow.ts) + [`/indexnow-key.txt`](apps/web/app/indexnow-key.txt/route.ts)，在 [`/api/revalidate`](apps/web/app/api/revalidate/route.ts) 内触发 | 发布即提交受影响 URL → Yandex + Bing；密钥文件 200，推送实测打通 api.indexnow.org |
| GSC / Yandex / Bing 站长验证 | Global 字段 → [`buildSiteMetadata`](apps/web/lib/seo.ts) | `<meta google-site-verification>` / `<meta yandex-verification>` 按 Global 注入 |
| Yandex.Metrica | Global `yandexMetricaId` → [`Analytics`](apps/web/components/Analytics.tsx) | 计数器脚本按 ID 注入（未配置则不注入） |
| hreflang | [`resolveMetadata`](apps/web/lib/seo.ts) `alternates.languages` | 每页输出 `hrefLang=zh-CN` + `x-default`，多语言可直接扩展 |

> IndexNow：`apps/web/.env` 设 `INDEXNOW_KEY`（`openssl rand -hex 16`），密钥经 `/indexnow-key.txt` 暴露校验。
> Google 不支持 IndexNow，靠 sitemap + GSC；Yandex/Bing 即时收录。

---

## M5 部署脚手架（配置就绪）

§7 部署约束。本地无法真部署，已备齐全部配置文件，按 [`deploy/README.md`](deploy/README.md) 执行。

| 目标 | 文件 |
|---|---|
| Strapi 容器化 | [`apps/cms/Dockerfile`](apps/cms/Dockerfile) + [`.dockerignore`](apps/cms/.dockerignore) |
| VPS 一键栈（Strapi+PG+Redis） | [`deploy/docker-compose.yml`](deploy/docker-compose.yml) + [`deploy/.env.example`](deploy/.env.example) |
| PM2（非 Docker 方案） | [`apps/cms/ecosystem.config.js`](apps/cms/ecosystem.config.js) |
| Nginx 反代 + TLS + admin IP 白名单 | [`deploy/nginx/cms.conf.template`](deploy/nginx/cms.conf.template) |
| 前台 Cloudflare Workers（OpenNext） | [`apps/web/open-next.config.ts`](apps/web/open-next.config.ts) + [`wrangler.toml`](apps/web/wrangler.toml) + [`.dev.vars.example`](apps/web/.dev.vars.example) |
| CI（lint/typecheck/build） | [`.github/workflows/ci.yml`](.github/workflows/ci.yml) |
| CI 部署前台 | [`.github/workflows/deploy-web.yml`](.github/workflows/deploy-web.yml) |
| 部署手册 + 上线检查清单 | [`deploy/README.md`](deploy/README.md) |

要点全部对齐 §7：`@opennextjs/cloudflare`（非 next-on-pages）、`nodejs_compat` + `compatibility_date 2024-12-30`、ISR 增量缓存绑 **Workers KV**、CORS 锁前台域名、admin IP 白名单、发布 webhook 联调（ISR + IndexNow + sitemap）。

---

## M6 运营（已实现）

| 能力 | 实现 | 验证 |
|---|---|---|
| 广告位投放 | AdSlot（含 `format` 标准尺寸）+ [`AdSlotBanner`](apps/web/components/AdSlotBanner.tsx) / [`AdAnchor`](apps/web/components/AdAnchor.tsx)（移动悬浮）；启动播种全站 19 个位（[`lib/adFormats.ts`](apps/web/lib/adFormats.ts) 尺寸表） | 按 key+时间窗渲染，按 format 预留宽高比（防 CLS）；**无创意不渲染**；首页/频道/文章/热门/搜索全覆盖，含信息流原生与移动悬浮 |
| PV 统计 | [`ViewTracker`](apps/web/components/ViewTracker.tsx) → 同源 [`/api/view`](apps/web/app/api/view/route.ts) → Strapi `view`（knex 原子自增，绕过 lifecycle） | 浏览自增 viewCount，published 行即时反映，不触发发布联动 |
| 热门排行 | [`HotList`](apps/web/components/HotList.tsx) 按 viewCount 倒序 | 首页「热门排行」榜，名次高亮 |
| 数据看板 | `GET /api/articles-stats`（总文章/总 PV/Top10）+ Strapi admin 可按 viewCount 排序；UV 由 Yandex.Metrica（M4）提供 | stats 接口返回聚合数据 |
| Turbo Pages（可选） | [`/turbo.rss`](apps/web/app/turbo.rss/route.ts) Yandex Turbo feed | 200，`application/rss+xml`，含 `turbo:content` |

---

## 里程碑总览

M1 脚手架 · M2 后台内容安全 · M3 前台打磨 · M4 SEO 收录 · M5 部署配置 · M6 运营 —— **全部完成**。
各里程碑均在本地 Strapi + PostgreSQL + Next 环境端到端实测通过。
