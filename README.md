# 今日吃瓜 · 移动优先多频道吃瓜资讯门户

聚合每日热点与全网热搜的吃瓜资讯站。前后端解耦：**Strapi 5（CMS）** + **Next.js 15（前台）**，
SEO 面向 **Google / Bing / Yandex**（不针对百度）。所有开发遵守 [`DEVELOPMENT_CONSTRAINTS.md`](./DEVELOPMENT_CONSTRAINTS.md)（强约束）。

> 版式仅参考资讯门户移动版的**结构**，**未**抓取/复制任何站点的文本、图片或数据。

---

## 目录结构

```
/apps
  /cms      # Strapi 5（PostgreSQL）→ 部署到 VPS
  /web      # Next.js 15 App Router + TS + Tailwind → Cloudflare Workers (OpenNext)
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
| 部署 | Strapi→VPS（Docker/PM2 + Nginx/TLS）；Next→Cloudflare Workers（`@opennextjs/cloudflare`） |

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

详见 [`deploy/README.md`](deploy/README.md)（含上线检查清单）。要点：
- **后台** → VPS：Docker Compose（Strapi+PG+Redis）或 PM2；Nginx 反代 + TLS（certbot）+ admin IP 白名单；CORS 锁前台域名。
- **前台** → Cloudflare Workers（OpenNext）：ISR 增量缓存绑 Workers KV；`nodejs_compat`。
- **发布联动**：Strapi lifecycle → 前台 `/api/revalidate`（按需 ISR）+ IndexNow 推送 + sitemap 刷新。
- CI：`.github/workflows/`（lint/typecheck/build + 前台部署）。

---

## 约束与规范

强约束见 [`DEVELOPMENT_CONSTRAINTS.md`](./DEVELOPMENT_CONSTRAINTS.md)：TypeScript strict、App Router（非 Pages）、PostgreSQL（生产禁 SQLite）、`@opennextjs/cloudflare`（禁 next-on-pages）、CORS 锁域名、先审后发、敏感词过滤、ICP 备案号占位、**不得抓取/复制任何站点内容**。
