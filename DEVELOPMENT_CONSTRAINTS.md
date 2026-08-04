# 新闻门户复刻项目 · 最终版开发方案约束

> 本文档是项目的**强约束规范**。所有开发（含 Claude Code）必须遵守。
> 约束级别：**MUST**（必须）/ **SHOULD**（建议）/ **MUST NOT**（禁止）。
> 模板仅参考 i.ifeng.com 移动版的**版式结构**，**MUST NOT** 抓取、复制其任何文本/图片/数据内容。

---

## 0. 项目定位

- 移动优先的**多频道内容门户**：顶部频道导航 + 按栏目分块的信息流 + 频道页 + 文章页。
- 前后端**解耦**：独立可视化后台（Strapi）+ 独立 SEO 友好前台（Next.js）。
- SEO 目标搜索引擎：**Google + Yandex**（**不做百度优化**）。

---

## 1. 技术栈约束（版本锁定）

| 层 | 选型 | 约束 |
|---|---|---|
| 后台/CMS | **Strapi 5.x** | MUST 用 v5（注意 v5 用 `documentId`，API 与 v4 不同） |
| 数据库 | **PostgreSQL 16+** | MUST。MUST NOT 用 SQLite 上生产 |
| 前台 | **Next.js 15 · App Router · TypeScript** | MUST 用 App Router；MUST NOT 用 Pages Router |
| 样式 | **Tailwind CSS** | MUST |
| 运行时 | **Node.js 20 LTS+** | MUST |
| 包管理 | **pnpm** | MUST（统一锁文件） |
| 缓存 | Redis | SHOULD（限流/会话/热点缓存） |
| 对象存储 | **Cloudflare R2** | SHOULD（媒体文件，配 CDN） |

- 具体小版本 **MUST** 锁进 `package.json` + lockfile，提交入库。
- MUST NOT 把任何密钥写进代码或仓库；统一走 `.env`（提供 `.env.example`）。

---

## 2. 仓库与架构约束

- MUST 采用 **pnpm workspaces 单仓多包**结构（也可拆两仓，但目录约定一致）：

```
/apps
  /cms      # Strapi 5（部署到 VPS）
  /web      # Next.js 15（部署到 Cloudflare Workers via OpenNext）
/packages
  /shared   # 共享 TS 类型（Article/Channel/SEO 等，前后台对齐）
pnpm-workspace.yaml
```

- 数据流 MUST 单向：**写入只经 Strapi**；前台只读「已发布」内容并静态化。
- 前台 **MUST NOT** 直连数据库；只通过 Strapi REST/GraphQL API 取数。
- 架构：

```
用户 → Cloudflare CDN/Workers
        └─ web (Next.js SSG/ISR)  ──API──►  cms (Strapi) ──►  PostgreSQL
                                                      └────►  R2 (媒体)
   发布事件: Strapi lifecycle ──► ① 前台按需 ISR 重生成  ② IndexNow 推送
```

---

## 3. 数据模型约束

### Collection Types
- **Channel 频道**：`name`, `slug`(唯一), `order`, `parent`(自关联,支持二级), `isNav`(是否上导航), `seo`(组件)
- **Article 文章**：`title`, `slug`(唯一), `summary`, `content`(富文本), `cover`(媒体), `channel`(关系), `tags`(关系), `author`, `source`, `publishAt`, `viewCount`, `seo`(组件)
  - 状态用 Strapi 的 **Draft & Publish**；扩展审核态见 §6
- **Tag 标签**：`name`, `slug`
- **AdSlot 推荐位**：`key`(位置标识,如 `home-top`/`channel-mid`), `title`, `image`, `link`, `enabled`, `startAt`, `endAt`

### Component（可复用）
- **seo.meta-data**（挂在 Article / Channel 上）：
  - `metaTitle`, `metaDescription`, `keywords`, `canonicalURL`,
  - `robots`（`index`/`noindex` + `follow`/`nofollow` 布尔）,
  - `ogTitle`, `ogDescription`, `ogImage`, `twitterCard`,
  - `structuredDataType`（`NewsArticle`/`Article`/`none`）, `structuredDataJSON`（可选覆盖）
- MUST 用官方 **`@strapi/plugin-seo`** 提供该组件能力。

### Single Type
- **Global 站点设置**：`siteName`, `defaultOgImage`, `titleTemplate`(如 `%s | 站名`), `defaultRobots`, 各站长验证码, ICP 备案号, 默认 SEO。

### 元数据回退链（前台 MUST 实现）
```
单页 seo 字段  >  Global 默认值  >  内容字段兜底(title/summary/cover)
```

---

## 4. SEO 约束（Google + Yandex）

**通用（两家通吃）**
- MUST 服务端输出完整首屏 HTML；**MUST NOT** 让正文/标题依赖客户端 JS 才出现。
- MUST 用 Next 原生 `generateMetadata` 渲染 title/description/OG/canonical，数据来自 §3 回退链。
- MUST 注入 **JSON-LD**：文章页 `NewsArticle`（含 `headline`/`datePublished`/`dateModified`/`author`/`image`）+ `BreadcrumbList`。
- MUST 生成动态 **`/sitemap.xml`** + **`/news-sitemap.xml`**（新闻图谱：含 `publication_date`、`title`、`name`/`language`）。
- MUST 提供 `/robots.txt`，引用上述 sitemap。
- SHOULD 预留 `hreflang`（即便当前单语言，结构先留好）。

**Google 专项**
- MUST 接入 **Google Search Console**（Global 里放验证 meta 或走 DNS）。
- MUST 关注 Core Web Vitals：`next/image` + ISR + 懒加载，LCP/CLS 达标。

**Yandex 专项**
- MUST 实现 **IndexNow**：文章发布/更新时 ping 一次，**Yandex + Bing 同时即时收录**（Google 不支持 IndexNow，仍靠 sitemap + GSC）。
- MUST 接入 **Yandex Webmaster**（验证 + 提交 sitemap）。
- SHOULD 装 **Yandex.Metrica**（对 Yandex 收录/排名有正反馈）。
- MAY 后期做 **Yandex Turbo Pages**（移动极速页，非首期）。

**URL 约束**
- 文章：`/{channelSlug}/{articleSlug}`（语义化短链，**MUST NOT** 用纯数字 ID）
- 频道：`/{channelSlug}`；标签：`/tag/{slug}`
- MUST 每页设 `canonical`，避免重复内容。

---

## 5. 前台渲染约束

- 文章页 / 频道页 MUST 用 **SSG + ISR**（`revalidate` 60–300s，保证新闻时效）。
- 首页 MUST **模块化渲染**：区块顺序与 variant（大图卡/左文右图/三图/纯文字）由后台数据驱动，**MUST NOT** 在前台硬编码栏目。
- 图片 MUST 走 `next/image`（WebP/懒加载）。
- MUST 实现**按需 ISR**：提供受 token 保护的 `revalidate` 接口，供 Strapi webhook 调用（`revalidateTag`/`revalidatePath`）。

---

## 6. 后台 / 内容安全约束

- 角色 MUST 三级：**管理员 / 编辑 / 审核**（Strapi RBAC）。
- 内容流转 MUST：`草稿 → 待审 → 已发布`（编辑提交、审核通过才发布）。
- MUST 接入**敏感词过滤**：提交/发布前校验标题+正文，命中拦截或标红。
- SHOULD 支持**定时发布**（`publishAt`）。
- 评论若开启 MUST「先审后发」。

---

## 7. 部署约束

**后台（VPS）**
- Strapi + PostgreSQL 跑在你的 Linux VPS；进程用 **PM2 或 Docker**，开机自启。
- 前置 **Nginx 反代 + TLS（Let's Encrypt）**；Strapi admin SHOULD 加 IP 允许名单。
- 媒体 SHOULD 存 **R2**（配 Strapi upload provider）；否则本地 + Nginx 静态。
- **CORS MUST** 锁定到前台域名，禁止 `*`。

**前台（Cloudflare）**

> ⚠️ **本节已与线上现状不符，勿照做。** 前台实际跑在与后台同一台 VPS 上：
> PM2 进程 `jrcg-web`（`next start -H 127.0.0.1 -p 3100`）+ Nginx 反代，
> Cloudflare 只做 DNS/CDN/WAF。实际拓扑见 [`deploy/OPS.md`](deploy/OPS.md)。
> 下列 MUST 是早期方案的约束，保留作历史记录；本节何时正式改写待定。

- ~~MUST 用 **`@opennextjs/cloudflare`** 适配器部署到 **Cloudflare Workers**（**MUST NOT** 用已弃用的 `next-on-pages`）。~~
- ~~MUST 开 `nodejs_compat`，`compatibility_date` ≥ `2024-09-23`。~~
- ~~ISR 增量缓存 MUST 绑定 **Workers KV**（静态资源可配 R2）。~~
- 构建 SHOULD 走 CI（GitHub Actions，Linux/macOS runner）。

**发布联动（MUST）**
- Strapi lifecycle hook 在「发布/更新/删除」时：
  1. 调用前台按需 ISR 接口重生成对应页面；
  2. 触发 **IndexNow** 推送该 URL；
  3. （可选）刷新 sitemap 缓存。

---

## 8. 合规约束（面向大陆访问时）

- 底部 MUST 预留 **ICP 备案号**占位（Global 字段驱动）。
- 新闻资讯内容 MUST 评估资质要求；上线前确认。
- §6 内容审核与敏感词为合规底线，**MUST NOT** 跳过。

---

## 9. 工程规范约束

- TypeScript **strict** MUST 开启；ESLint + Prettier MUST 接入并入 CI。
- 前后台共享类型 MUST 放 `/packages/shared`，单一事实来源。
- 提交信息 SHOULD 用 Conventional Commits。
- 所有配置 MUST env 驱动；MUST 提供 `.env.example`。

---

## 10. M1 脚手架交付范围（Definition of Done）

M1 完成判定（全部满足才算过）：
1. `pnpm install` 在根目录一键装好 `apps/web` + `apps/cms`。
2. Strapi 5 连通 PostgreSQL，建好 **Channel / Article / Tag / AdSlot** + **seo 组件** + **Global**，装好 `@strapi/plugin-seo`。
3. Next 15（App Router + TS + Tailwind）能取 Strapi 数据，渲染出**首页(模块化) / 频道页 / 文章页**三个路由的最小版本。
4. 文章页已注入 `generateMetadata` + `NewsArticle` JSON-LD（走回退链）。
5. `/sitemap.xml`、`/news-sitemap.xml`、`/robots.txt` 可访问。
6. `.env.example`、`README`、本约束文档入库。

> IndexNow 自动推送、Yandex/Google 站长验证、审核流、R2、OpenNext 部署 → 放 M2–M5，不阻塞 M1。

---

## 后续里程碑（概览）

- **M2 后台**：RBAC 三角色 + 审核流 + 敏感词 + 媒体库 + 定时发布
- **M3 前台**：首页模块编排打磨 + 卡片 variant + 分页/相关推荐 + ISR 按需重生成
- **M4 SEO**：IndexNow + GSC + Yandex Webmaster + Metrica + hreflang
- **M5 部署**：Strapi 上 VPS（PM2/Docker+Nginx+TLS）、Next 上 Cloudflare Workers（OpenNext+KV）、发布 webhook 联调
- **M6 运营**：数据看板（PV/UV/热门）、广告位投放、（可选）Turbo Pages
