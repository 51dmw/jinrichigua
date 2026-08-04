# 今日吃瓜 · 移动优先多频道吃瓜资讯门户

聚合每日热点与全网热搜的吃瓜资讯站。前后端解耦：**Strapi 5（CMS）** + **Next.js 15（前台）**，
SEO 面向 **Google / Bing / Yandex**（不针对百度）。所有开发遵守 [`DEVELOPMENT_CONSTRAINTS.md`](./DEVELOPMENT_CONSTRAINTS.md)（强约束）。

> 版式仅参考资讯门户移动版的**结构**，**未**抓取/复制任何站点的文本、图片或数据。

---

## 目录结构

```
/apps
  /cms      # Strapi 5（PostgreSQL）→ 部署到 VPS
  /web      # Next.js 15 App Router + TS + Tailwind → 同一台 VPS（PM2 + Nginx）
/packages
  /shared   # 前后台共享 TS 类型（单一事实来源）
/deploy     # 部署手册 + Docker/Nginx/上线检查清单
```

数据单向流动：**写入只经 Strapi**；前台只读「已发布」内容并静态化（SSG + ISR），**不直连数据库**。

## 技术栈

| 层 | 选型 |
|---|---|
| CMS | Strapi 5.x（`documentId`、Draft & Publish、lifecycle、RBAC、组件） |
| 数据库 | PostgreSQL 16+（生产禁用 SQLite） |
| 前台 | Next.js 15 · App Router · TypeScript · Tailwind |
| 运行时 / 包管理 | Node.js 20 LTS+ · pnpm workspaces |
| 部署 | 前后台同机 VPS：Strapi→Docker Compose，Next→PM2 `next start`，统一由 Nginx 反代；Cloudflare 只做 DNS/CDN |

---

## 快速开始

**先决条件**：Node 20 LTS+、pnpm 9+、可连接的 PostgreSQL 16+（建库 `newsportal`）。

```bash
# 1. 装依赖
pnpm install

# 2. 配环境变量（MUST NOT 提交任何 .env）
cp apps/cms/.env.example apps/cms/.env        # 填 DB 连接 + 随机密钥（openssl rand -base64 32）
cp apps/web/.env.example apps/web/.env.local  # 填 SITE_URL / STRAPI_API_URL

# 3. 起服务
pnpm --filter shared build   # 先编译共享类型
pnpm dev:cms                 # 后台 http://localhost:1337/admin（首次注册管理员）
pnpm dev:web                 # 前台 http://localhost:3000
```

> CMS 首启会自动播种：12 个频道、演示文章（带封面+标签+作者）、29 位作者、广告位、信息页、站点设置，
> 并开放 public 只读权限——前台启动即有内容可看。

**常用脚本**：`pnpm dev`（并行起两端）· `pnpm build`（shared→cms→web）· `pnpm --filter web typecheck` / `lint`。

---

## 核心能力

### 内容与后台
- **内容模型**（后台类目均为中文）：频道 / 文章 / 作者 / 标签 / 评论 / 广告位 / 信息页 / 敏感词 / 首页编排 / 站点设置。
- **审核流**：草稿 → 待审 → 已发布；**发布守卫**（`reviewState!=approved` 禁止 publish，admin/API/cron 全生效）+ **敏感词过滤** + 定时发布 cron。
- **RBAC**：内置 Super Admin + 自动建「编辑（无发布权）/ 审核（可发布）」两角色。
- **首页编排**：单类型 `home-page` 驱动区块顺序/版式/取数，前台零硬编码栏目。

### 前台
- 移动优先；首页模块化区块、卡片多版式（大图/左文右图/三图/纯文字/左图右标题）。
- 频道 / 标签 / 作者 / 搜索 / **吃瓜热榜** / **文章归档（按年月）** 全套页面。
- **列表页 20/页、翻页限深 5 页**（更深走归档+sitemap，参考凤凰式做法）；搜索/热榜/归档按定位例外。
- 相关推荐**按共享标签相关**（非同频道堆叠）；侧栏「频道最新」左图右标题。
- 面包屑根节点用品牌名、标签内链统一胶囊样式。

### 评论
- 任何人可评论、**先审后发**；多重防刷：链接/广告词/敏感词过滤、IP 限流、重复内容、跨站/空 UA、蜜罐、可选 **Cloudflare Turnstile** 无感人机验证。

### SEO（Google / Bing / Yandex）
- canonical / hreflang；NewsArticle / BreadcrumbList / ItemList / Organization / WebSite / Person JSON-LD。
- 分层 sitemap（索引 + 频道/标签/作者/文章分片）+ Google 新闻图谱 + **IndexNow**（发布即推 Bing/Yandex）。
- 文章归档页做老内容内链枢纽；空标签/空聚合页 404 不收录；URL 规范化（小写/去尾斜杠）；搜索页 `noindex`。
- 简体中文系统字体栈（零 Web 字体）、`theme-color`、`format-detection`、AVIF/WebP 图片、CLS≈0。

### 运营 & 品牌
- **广告位**：全站 19 个位，按 `format` 标准尺寸（横幅/信息流/矩形/半屏/移动悬浮）预留宽高比防 CLS；无创意不渲染；占位图预览模式。
- PV 统计（原子自增）、热门排行、**精选标签**（按标签最热文章点击数排序）。
- 品牌视觉：西瓜切片 logo / favicon / PWA manifest / apple-icon（`ImageResponse` 生成）、无图时品牌封面占位图。

---

## 部署

线上实际拓扑与运维手册见 [`deploy/OPS.md`](deploy/OPS.md)；初次搭建步骤见 [`deploy/README.md`](deploy/README.md)。要点：

- **前后台跑在同一台 VPS 上**，都由 Nginx 反代：
  - **后台** → Docker Compose（Strapi + PostgreSQL + Redis），Strapi 绑 `127.0.0.1:1337`。
  - **前台** → PM2 进程 `jrcg-web`（`next start -H 127.0.0.1 -p 3100`），用 `scripts/deploy-web.sh` 原子切换 `.next` 后重启。
- **Cloudflare 只做 DNS / CDN / WAF**，不承载前台运行时。
- **发布联动**：Strapi lifecycle → 前台 `/api/revalidate`（按需 ISR）+ IndexNow 推送 + sitemap 刷新。
- CI：`.github/workflows/ci.yml`（lint/typecheck/build）。

> **关于 Cloudflare Workers**：`wrangler.toml`、`open-next.config.ts`、`@opennextjs/cloudflare` 依赖、
> `pnpm --filter web deploy` 脚本和 `.github/workflows/deploy-web.yml` 都还在仓库里，但**当前线上不走这条路**。
> 那套是早期方案的遗留，未随后续改动验证过。复制到新项目时：要么按上面的 PM2 方案走并删掉这些残留，
> 要么先自行验证 Workers 路径可用——不要假设它开箱能跑。

---

## 用这套代码起新站

换站名、换域名、换视觉起一个新站点 → **[`docs/REBRAND.md`](docs/REBRAND.md)**。
里面逐项列了所有写死品牌/域名的位置、判定方法和收尾自检命令。

要点预告：站名基本集中在 `apps/cms/src/index.ts` 的播种逻辑里（前台多数地方读 Strapi 的
`global.siteName`，不写死）；域名在代码里只有 `apps/web/next.config.ts` 的 R2 图片域必改，
canonical/sitemap/OG 全走 `SITE_URL` 环境变量；品牌视觉是代码画的 SVG，需要重画而非替换图片。

---

## 约束与规范

强约束见 [`DEVELOPMENT_CONSTRAINTS.md`](./DEVELOPMENT_CONSTRAINTS.md)：TypeScript strict、App Router（非 Pages）、PostgreSQL（生产禁 SQLite）、CORS 锁域名、先审后发、敏感词过滤、ICP 备案号占位、**不得抓取/复制任何站点内容**。

> 该文档「前台（Cloudflare）」一节已与线上现状不符（前台实为本机 PM2），节内有勘误说明。
