# 部署手册（M5）

架构（§2/§7）：
```
用户 → Cloudflare CDN/Workers (web, OpenNext)
              │  ISR 增量缓存 → Workers KV
              └── API ──► VPS: Nginx(TLS) → Strapi 5 → PostgreSQL 16
                                                  └► R2（媒体，可选）
发布事件: Strapi lifecycle ──► ① 前台 /api/revalidate（ISR 重生成）
                              ② IndexNow（Yandex+Bing）③ sitemap 刷新
```

---

## A. 后台 Strapi 上 VPS

### 方式一：Docker Compose（推荐）
```bash
cp deploy/.env.example deploy/.env      # 填 DB 密码 + 6 个 Strapi 密钥（openssl rand -base64 32）
docker compose -f deploy/docker-compose.yml up -d --build
docker compose -f deploy/docker-compose.yml logs -f cms
```
- Postgres / Redis 仅容器内网；Strapi 只绑 `127.0.0.1:1337`，对外由 Nginx 反代。
- 媒体挂卷 `cms_uploads`（若用 R2 则不需要）。

### 方式二：PM2
```bash
cd apps/cms && cp .env.example .env   # 填 DB + 密钥（DATABASE_HOST 指向你的 PG）
pnpm install && pnpm build
pm2 start ecosystem.config.js && pm2 save && pm2 startup   # 开机自启
```

### Nginx + TLS（两种方式都需要）
```bash
cp deploy/nginx/cms.conf.template /etc/nginx/sites-available/cms.conf
#  改 server_name 与 /admin 的 allow IP 名单
ln -s /etc/nginx/sites-available/cms.conf /etc/nginx/sites-enabled/
certbot --nginx -d cms.example.com      # Let's Encrypt 证书
nginx -t && systemctl reload nginx
```
要点：**CORS 必锁前台域名**（`CORS_ORIGINS`，§7）；**admin 加 IP 白名单**（§7）。

### R2 媒体（可选，§7 SHOULD）
```bash
pnpm --filter cms add @strapi/provider-upload-aws-s3
```
取消 `apps/cms/config/plugins.ts` 里 upload 段注释，并在环境填 `R2_*`。

---

## B. 前台 Next 上 Cloudflare Workers（OpenNext）

> MUST 用 `@opennextjs/cloudflare`，**禁用** `next-on-pages`（§7）。

```bash
cd apps/web
# 1) 建 ISR 用的 KV 命名空间，把返回 id 填进 wrangler.toml
wrangler kv namespace create NEXT_INC_CACHE_KV

# 2) 写公开变量到 wrangler.toml [vars]；机密用 secret：
wrangler secret put REVALIDATE_TOKEN     # 与 Strapi 的 WEB_REVALIDATE_TOKEN 一致
wrangler secret put INDEXNOW_KEY
# 可选： wrangler secret put STRAPI_API_TOKEN

# 3) 本地预览 / 部署
pnpm --filter web preview
pnpm --filter web deploy
```
- `compatibility_date ≥ 2024-09-23` + `nodejs_compat` 已在 `wrangler.toml` 配好（§7）。
- ISR 增量缓存绑定 Workers KV（§7）；静态资源走 Workers Assets，缓存亦可选配 R2。
- CI 自动部署见 `.github/workflows/deploy-web.yml`（配 `CLOUDFLARE_API_TOKEN`/`ACCOUNT_ID` secrets）。

---

## C. 发布联动联调（§7 MUST）

1. **前台域名 + 共享 token**：Strapi `.env` 的 `WEB_REVALIDATE_URL=https://example.com/api/revalidate`、`WEB_REVALIDATE_TOKEN` 与前台 `REVALIDATE_TOKEN` 一致。
2. **触发链路**（已实现，见 `apps/cms/.../article/lifecycles.ts` → `apps/web/app/api/revalidate`）：
   文章 发布/更新/删除 → Strapi lifecycle ping 前台 →
   ① `revalidateTag/Path` 按需 ISR 重生成 ② IndexNow 推送该 URL ③ sitemap 缓存刷新。
3. **冒烟测试**：
   ```bash
   curl -X POST https://example.com/api/revalidate \
     -H "Authorization: Bearer <REVALIDATE_TOKEN>" -H "Content-Type: application/json" \
     -d '{"type":"article","channelSlug":"news","articleSlug":"<slug>"}'
   # 期望 {"ok":true,"revalidated":[...],"indexNow":{...}}
   ```
4. **站长平台**：Google Search Console（GSC）+ Yandex Webmaster
   - 验证码填 Strapi Global（已自动注入 meta），或走 DNS 验证。
   - **只需提交索引 `https://example.com/sitemap.xml`**——它是 `sitemapindex`，会自动发现下面所有子 sitemap，无需逐个提交：

     ```
     /sitemap.xml                      ← 顶层索引（提交这个）
     ├── /sitemaps/channels.xml        首页 + 热榜 + 频道
     ├── /sitemaps/tags.xml            标签（仅有文章的）
     ├── /sitemaps/authors.xml         作者（仅有文章的）
     ├── /news-sitemap.xml             Google 新闻图谱
     └── /sitemaps/articles.xml?page=N 文章，每片 ≤45000 条，超量自动分片
     ```
   - 新闻站可在 GSC 单独再提交一次 `/news-sitemap.xml`（新闻收录走专用图谱，非必需）。

---

## 浏览器兼容 · 简体中文 · 性能（已实现）

**简体中文**
- `<html lang="zh-CN">`、`og:locale=zh_CN`、hreflang `zh-CN` + `x-default`。
- 系统中文字体栈（PingFang SC / 微软雅黑 / Noto Sans CJK SC …），**零 Web 字体下载**，无 FOUT/FOIT。
- Strapi admin 简体中文（`prefered_language=zh-Hans`）。

**搜索引擎（Google / Bing / Yandex）**
- robots 含 Yandex `Host` 指令；`/sitemap.xml` 索引 + Google 新闻图谱；三家站点验证 meta 自动注入。
- IndexNow（Bing + Yandex 即时收录），文章发布即推送。
- canonical/hreflang、NewsArticle/BreadcrumbList/ItemList 等 JSON-LD。

**浏览器兼容**
- 复制链接：Clipboard API + `textarea+execCommand` 回退（兼容**微信/QQ 内置浏览器**、非 HTTPS）。
- `<meta name="format-detection" content="telephone=no">`：iOS 不把中文正文里的数字误识别成电话。
- 图片以 `aspect-ratio` 预留高度（现代浏览器 96%+ 支持）。

**性能 / Core Web Vitals**
- next/image：AVIF/WebP、`sizes` 响应式、LCP 图 `priority`、其余懒加载；固定宽高比 → **CLS≈0**。
- 广告位按 `format` 预留标准尺寸，无创意不渲染 → 零空位抖动。
- Yandex Metrica `lazyOnload`（空闲加载，降 TBT/INP）。
- 跨域 `preconnect`（媒体/统计）、`theme-color`、移动优先视口。

> ⚠️ **依赖 HTTPS**：复制链接的 Clipboard API、`theme-color`、未来的 Service Worker 等仅在 HTTPS 下生效。生产务必启用 TLS（Cloudflare 默认 https；VPS 侧 Strapi 用 certbot）。

---

## 上线检查清单

- [ ] Strapi 密钥/DB 密码全为随机值，未入库
- [ ] `CORS_ORIGINS` = 前台正式域名（非 `*`）
- [ ] Strapi admin IP 白名单生效，TLS 证书有效
- [ ] 删除开发用 `SEED_DEV_TOKEN` 创建的 full-access token
- [ ] 前台 `wrangler.toml` 的 KV id 已填、机密已 `secret put`
- [ ] `WEB_REVALIDATE_TOKEN` 两端一致，冒烟测试通过
- [ ] `INDEXNOW_KEY` 已配，`/indexnow-key.txt` 可访问
- [ ] GSC / Yandex Webmaster 已验证，并**只提交索引 `/sitemap.xml`**（子 sitemap 自动发现）
- [ ] 抽查 `/sitemap.xml` 返回 `sitemapindex`、各子 sitemap 均 200、空频道/标签/作者未被收录
- [ ] **HTTPS/TLS 已启用**（复制链接 Clipboard API、`theme-color` 等依赖）
- [ ] 前台 head 实测含 `viewport` / `theme-color=#c1272d` / `format-detection` / `og:locale=zh_CN`
- [ ] 微信/QQ 内置浏览器实测：中文排版正常、复制链接可用、移动悬浮广告可关闭
- [ ] Lighthouse 移动端抽查 Core Web Vitals：LCP / CLS / INP 达标
