# 今日吃瓜 — 项目约定

全局规范见 `~/.claude/CLAUDE.md`。本文只写这个项目特有的、**从代码里看不出来的**东西。

---

## 一、这台机器就是生产环境

仓库所在的 VPS 同时跑着线上前台和后台。没有独立的开发/预发机器。
改动落地即影响真实访问，跑命令前先确认后果。

线上拓扑、进程、定时任务、备份 → **`deploy/OPS.md`**（先读它再动运维相关的东西）。

---

## 二、三个最容易踩的坑

**1. 改 `apps/cms` 必须重建 Docker 镜像才生效。**
CMS 没有 CI。只 commit 不重建 = 线上没变化。

```bash
docker compose -f deploy/docker-compose.yml up -d --build cms
```

**2. 前台发版只走 `bash scripts/deploy-web.sh`。**
它先构建到临时目录、校验通过后才原子切换 `.next` 并重启 PM2。
直接 `pnpm --filter web build` 会就地写 `.next`，构建一失败就是线上 502。

**3. 「取消发布」会被自动回滚。**
Strapi 有定时发布 cron：`reviewState=approved` 的草稿每分钟自动重新发布。
下架文章只能删除，或先改掉 `reviewState`。

---

## 三、文档里已经过时的部分

`README.md` 和 `DEVELOPMENT_CONSTRAINTS.md` 早期写的是「前台部署到 Cloudflare Workers（OpenNext）」。
**实际前台跑在本机 PM2 上**，Cloudflare 只做 DNS/CDN/WAF。

`wrangler.toml`、`open-next.config.ts`、`@opennextjs/cloudflare` 依赖、
`.github/workflows/deploy-web.yml` 都还在仓库里，属于**未验证的遗留**——别照着改，也别假设它能跑。

主域是 **`tobaoliao.com`**（2026-07-23 从 `sibian.xyz` 迁移，旧域整站 301）。
文档里残留的 `sibian.xyz` 若指前台，多半是旧文。

---

## 四、内容生成的口径

`scripts/hot-sync/` 是热榜二创管线（抓热榜 → 生成 → 入草稿）。写 prompt 或改生成逻辑时：

- **不许编造数据**：具体数字、时间、当事人表态，没有来源就不写。
- **但也不要反复声明「数据未公开」「官方尚未回应」**——那是另一种套话，读起来同样像机器写的。
  没有的信息直接不提即可。
- 生成后端默认 `claude`，走本机订阅登录态。脚本会显式把子进程的 `ANTHROPIC_API_KEY` 置空，
  **不要**在 `scripts/hot-sync/.env` 里配这个键。

正文结构受前台 markdown 渲染器约束（`apps/web/lib/markdown.tsx`）。
改「让文章带某某结构」这类 prompt 前，先确认渲染器支持那个语法，否则出稿是一堆裸标记。

---

## 五、拿这套代码起新站

换品牌/域名的完整清单见 `docs/REBRAND.md`。别凭印象改——站名和域名的分布不直觉：

- 站名几乎全在 `apps/cms/src/index.ts` 的播种逻辑里，前台多数地方读 Strapi `global.siteName`
- 域名在代码里**只有** `apps/web/next.config.ts` 的 R2 图片域是硬编码，其余走 `SITE_URL`
- 播种函数 `rebrandGuaToday()` 有 store flag 守卫只跑一次，拷库起新站时改代码不会重新播种

---

## 六、SEO 相关

规则落地点分散，改之前先看 `docs/seo-training/` 下的 `SUMMARY.md` 和 `GAP.md`。
列表页翻页限深 5 页（更深走归档 + sitemap），这是有意的，不是 bug。
