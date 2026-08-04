# 换品牌 / 起新站清单

用这套代码起一个**新站点**（换站名、换域名、换视觉）时照此逐项过。
每项给了文件位置和判定方法；行号会随改动漂移，所以每节末尾附了重新定位用的 `git grep`。

> 前置：新站的**站名、域名、11 个频道要不要改**先定下来。频道 slug 会进 URL，
> 起站后再改等于换掉全站链接结构，成本高得多。

---

## 0. 先跑一遍现状扫描

```bash
# 站名
git grep -n -I '今日吃瓜' -- $(git ls-files | grep -v '^docs/seo-training/raw/')
# 域名
git grep -n -I -E 'tobaoliao|sibian' -- $(git ls-files | grep -v '^docs/seo-training/raw/')
# 路径与进程名
git grep -n -I -E 'jinrichigua|jrcg' -- $(git ls-files)
# 品牌色
git grep -n -I -i -E 'c1272d|e8484d' -- $(git ls-files)
```

排除 `docs/seo-training/raw/` 是因为那是抓下来的外部教材原文，不属于本站内容。

---

## 1. CMS 播种文案（改这里收益最大）

**`apps/cms/src/index.ts`** —— 站名几乎全部集中在这一个文件。
前台大多数地方读的是 Strapi 里的 `global.siteName`，**不是写死的**，
所以改完播种文案，新站首启出来就是新品牌。

| 位置 | 内容 | 必改 |
|---|---|---|
| `REBRAND_CHANNELS`（约 165 行） | 11 个频道的名称与 slug | 看是否换频道体系 |
| `CHANNEL_DESCRIPTIONS`（约 181 行） | 各频道 SEO 描述 | 跟随频道 |
| `DEFAULT_SEO_DESCRIPTION`（约 196 行） | 默认 meta description | ✅ |
| `rebrandGuaToday()` 内 homeIntro / disclaimer（约 352 行） | 首页简介、免责声明 | ✅ |
| 同上 `siteName` / `titleTemplate`（约 360、365 行） | `%s \| 站名` | ✅ |
| `seedContent()` 内 `siteName` / `titleTemplate`（约 534 行） | 同上，另一条播种路径 | ✅ |
| `icpRecord`（约 537 行） | 已是占位 `京ICP备XXXXXXXX号-1` | 备案下来再填 |
| `PAGE_SEED`（约 636 行） | 「关于我们」等信息页正文 | ✅ |

### ⚠️ 播种只跑一次

`rebrandGuaToday()` 开头有 store flag 守卫：

```ts
if (await store.get({ key: 'rebrandGuaTodayHasRun' })) return;
```

- **空库首启** → 正常播种，改代码即生效。
- **拷贝现有数据库起新站** → flag 已是 `true`，改了代码也不会重新播种。
  这种情况要么手工改库里的数据，要么先清掉这个 store key。

> 未验证：空库首启的完整播种流程本人没实测过，第一次起新站请留意 Strapi 启动日志里的
> `[bootstrap] rebrand → …` 一行是否出现。

---

## 2. 前台写死的文案

大部分前台文案走 Strapi 字段，但下面这些是**真写死或兜底值**，要手工改：

| 文件 | 位置 | 性质 |
|---|---|---|
| `apps/web/components/Breadcrumb.tsx` | `const HOME_BRAND` | 写死，面包屑根节点 |
| `apps/web/app/manifest.ts` | `name` / `short_name` | 写死，PWA |
| `apps/web/app/not-found.tsx` | `title.absolute` | 写死，404 页 |
| `apps/web/app/llms.txt/route.ts` | `global?.siteName ?? '…'` | 兜底 |
| `apps/web/app/page.tsx` | `fallbackTitle` | 兜底，首页 |
| `apps/web/app/search/page.tsx` | 搜索页描述（2 处） | 写死 |
| `apps/web/app/archive/page.tsx` | `fallbackDescription` | 兜底 |
| `apps/web/components/TagView.tsx` | 标签页 fallback 描述 | 兜底 |

---

## 3. 域名

**代码里只有一处必改**：

```
apps/web/next.config.ts   images.remotePatterns 里的 hostname: 'img.sibian.xyz'
```

不改的话新站的 R2 图片会被 Next 图片优化拒绝。

其余域名出现都不是硬编码：

- `deploy/docker-compose.yml` 的 `URL: ${URL:-https://cms.sibian.xyz}` 是 fallback，
  在 `deploy/.env` 里设 `URL` 即可覆盖。
- `apps/cms/config/plugins.ts`、`apps/web/middleware.ts` 里只是注释。
- `deploy/OPS.md`、`CLAUDE.md`、`docs/` 里是描述性文档，跟着改。

**前台没有写死站点域名**：canonical / sitemap / OG 全部走 `SITE_URL` 环境变量。
换域名只要改 `apps/web/.env.local` 的 `SITE_URL`。

---

## 4. 路径与进程名

| 文件 | 内容 | 说明 |
|---|---|---|
| `scripts/deploy-web.sh` | `WEB=/root/jinrichigua/apps/web`、`cd /root/jinrichigua` | 绝对路径，换目录必改 |
| `scripts/deploy-web.sh` | `pm2 restart jrcg-web` | PM2 进程名 |
| `deploy/backup-db.sh` | `CONTAINER="jinrichigua-postgres-1"` | 容器名 = compose 项目名（默认取目录名） |
| `apps/cms/src/api/friend-link/controllers/friend-link.ts` | `IP_SALT = 'jinrichigua::friend-link::ip-salt::v1'` | 见下 |

`IP_SALT` 是友链埋点的 IP 哈希盐。不改不影响运行，但**建议改**——
两个站用同一个盐，同一访客的 IP 哈希在两边可复现关联。

PM2 进程名（`jrcg-web` / `jrcg-hot-sync` / `jrcg-repair`）不在仓库里，
是机器状态，新机器上 `pm2 start` 时自己定，改名记得同步 `deploy-web.sh`。

---

## 5. 品牌视觉

西瓜切片标是**代码画的**（SVG path / `ImageResponse`），不是可替换的图片文件，要重画：

| 文件 | 是什么 |
|---|---|
| `apps/web/app/icon.svg` | favicon |
| `apps/web/app/apple-icon.tsx` | 180×180，`ImageResponse` 运行时生成 |
| `apps/web/app/favicon.ico` | 二进制，**唯一需要外部工具重做的** |
| `apps/web/public/logo.svg` | 白色版字标 |
| `apps/web/public/logo-color.svg` | 彩色版字标 |
| `apps/web/components/Logo.tsx` | React 组件版（导航栏用） |
| `apps/web/components/CoverPlaceholder.tsx` | 文章无封面时的品牌占位图 |
| `scripts/hot-sync/gen_cover.py` | 二创封面图生成，带站名水印 |

### 品牌色

`apps/web/tailwind.config.ts` 里定义了 token：

```ts
brand: { DEFAULT: '#c1272d', dark: '#a01f24' }
```

**但 SVG 和 `ImageResponse` 进不了 Tailwind**，所以 `#c1272d` 还以字面量散在 8 个文件里，
`#e8484d`（瓜瓤色）同理。改主色要连带手工同步这些，用 §0 的 grep 兜一遍。

另外两处也是主色，别漏：

- `apps/web/app/layout.tsx` 的 `themeColor`
- `apps/web/app/manifest.ts` 的 `theme_color`

---

## 6. 二创管线的文案

`scripts/hot-sync/` 走 Claude 生成，prompt 里带了站名和站点定位：

- `index.mjs` 的 `DEFAULT_PICK_PROMPT`（约 598 行）—— 选题编辑人设
- `index.mjs` 的成文 prompt（约 630 行）—— 「你在为吃瓜资讯站『…』供稿」
- `gen_cover.py`（约 90 行）—— 封面水印文字

还有两处与「吃瓜」这个品类强绑定，换品类要一起改：

- `index.mjs` 频道映射表（约 383 行）—— slug → 中文频道说明，喂给模型判断归类
- `FILL_TAG_STOPLIST`（约 940 行）—— 泛词标签黑名单（`吃瓜`/`大瓜`/`热搜`…）

---

## 7. 环境与外部服务（都要重新申请）

代码之外、必须在新环境重建的：

- 三份 `.env` 的真实值（模板见各 `.env.example`，键名齐全）
- 新的 Strapi API Token（hot-sync 用，需要哪些权限见 `scripts/hot-sync/.env.example`）
- 新的 R2 桶 + **防盗链 WAF 规则**（规则本身没有导出到仓库，要在 CF 控制台重建，
  白名单记得放行搜索引擎爬虫）
- 域名、证书、IndexNow key、GA / Yandex Metrica ID
- 前台的 Nginx 配置（仓库只有 `deploy/nginx/cms.conf.template`，前台那份要照
  `deploy/OPS.md` 的拓扑手写）
- crontab 备份那行、PM2 三个进程

线上实际长什么样见 **`deploy/OPS.md`**。

---

## 8. 收尾自检

```bash
# 应当只剩 docs/ 下的历史记述，代码里不该有旧站名
git grep -n -I '今日吃瓜' -- $(git ls-files | grep -v '^docs/')
# 代码里不该有旧域名
git grep -n -I -E 'tobaoliao|sibian' -- $(git ls-files | grep -vE '^(docs/|deploy/OPS.md|CLAUDE.md)')
```

两条都应为空。作为对照，**改之前**在本仓库跑这两条分别是 36 行和 5 行
（第二条那 5 行就是 §3 列的：`next.config.ts` 的图片域、`docker-compose.yml` 的 URL fallback
及其 `.env.example` 说明、两处注释）。

再起服务确认：

- 首页 title 是新站名，`/manifest.webmanifest` 里 `name` 是新站名
- favicon / 导航 logo 是新视觉
- 随便点一篇文章，无封面时的占位图是新品牌
- Strapi 后台「站点设置」里 `siteName` / `titleTemplate` 是新值
