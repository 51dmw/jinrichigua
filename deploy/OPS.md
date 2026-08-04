# 线上运维手册（今日吃瓜）

记录**当前这台 VPS 上实际跑着什么**——进程、反代、定时任务、备份。
`deploy/README.md` 讲的是初次搭建，本文讲的是搭好之后长什么样。

> 复制到新项目时：本文里的域名、端口、容器名都要替换。
> 定时任务与 PM2 进程列表**没有**存进仓库（crontab / `~/.pm2/dump.pm2` 是机器状态），
> 换机器要照本文手工重建。

---

## 1. 拓扑

前后台跑在**同一台 VPS** 上，统一由宿主 Nginx 反代。Cloudflare 只做 DNS / CDN / WAF，
**不承载前台运行时**（仓库里的 OpenNext / Workers 配置是遗留，见 README「关于 Cloudflare Workers」）。

```
浏览器
  └─ Cloudflare（DNS/CDN/WAF）
       └─ VPS Nginx :80/:443
            ├─ tobaoliao.com        → upstream jrcg_web → 127.0.0.1:3100  （PM2 前台）
            ├─ www.tobaoliao.com    → 301 → tobaoliao.com
            ├─ sibian.xyz           → 301 → tobaoliao.com    （主域迁移 2026-07-23）
            ├─ www.sibian.xyz       → 301 → tobaoliao.com
            └─ cms.sibian.xyz       → 127.0.0.1:1337         （Docker 里的 Strapi）
```

**主域是 `tobaoliao.com`**，旧域 `sibian.xyz` 整站 301 平移权重。
媒体走 R2，对外域名 `img.sibian.xyz`（配了防盗链 WAF 规则，白名单含搜索引擎爬虫）。

---

## 2. 进程

### 2.1 前台 — PM2

| 进程 | 命令 | cwd | 说明 |
|---|---|---|---|
| `jrcg-web` | `next start -H 127.0.0.1 -p 3100` | `apps/web` | 常驻，Nginx 上游 |
| `jrcg-hot-sync` | `scripts/hot-sync/index.mjs --limit 7` | `scripts/hot-sync` | `cron_restart: 15 */2 * * *`，跑完即退 |
| `jrcg-repair` | `scripts/hot-sync/repair.mjs --phase b --limit 12` | 仓库根 | `cron_restart: 45 */2 * * *`，跑完即退 |

后两个是定时任务型进程，**平时 `pm2 list` 显示 `stopped` 是正常的**——到点由 PM2 拉起，
跑完自己退出。看到 stopped 不要手动 `pm2 restart` 去"修"它。

开机自启：`systemd` 单元 `pm2-root` 已 enabled，进程列表存在 `~/.pm2/dump.pm2`。
**改完进程配置务必 `pm2 save`**，否则重启机器后改动丢失。

### 2.2 后台 — Docker Compose

```
jinrichigua-cms-1        jinrichigua-cms       127.0.0.1:1337->1337
jinrichigua-postgres-1   postgres:16-alpine    仅容器内网
jinrichigua-redis-1      redis:7-alpine        仅容器内网
```

编排文件 `deploy/docker-compose.yml`，机密读 `deploy/.env`。

---

## 3. 发版

### 3.1 前台

```bash
bash scripts/deploy-web.sh
```

先构建到 `.next-build`，校验 `BUILD_ID` 存在后才原子切换（`.next`→`.next-prev`，
`.next-build`→`.next`）再 `pm2 restart jrcg-web`。任何一步失败即中止，
线上正在跑的 `.next` 不受影响。

**MUST NOT 直接 `pnpm --filter web build`** —— 那会就地写 `.next`，构建失败就是 502。

回滚：`.next-prev` 是上一版，换回来再 restart 即可。

### 3.2 后台

CMS **没有 CI**，改了 `apps/cms` 要重建镜像才生效：

```bash
docker compose -f deploy/docker-compose.yml up -d --build cms
```

只改 git 不重建镜像 = 线上没变化。后台汉化这类改动最容易踩这个坑。

---

## 4. 定时任务

### 4.1 crontab（`crontab -l`，root）

```cron
45 2 * * * /root/jinrichigua/deploy/backup-db.sh >> /root/jinrichigua/data/backups/backup.log 2>&1
```

> 这台机器上还有其他项目（`xunzhan-main`、`seohandbook`）的 cron 条目，
> 编辑 crontab 时**不要整份覆盖**，只增删本项目那行。

### 4.2 PM2 cron_restart

见 §2.1 的 `jrcg-hot-sync` / `jrcg-repair`。热榜二创管线走这里，不走 crontab。

### 4.3 Strapi 内部定时发布

Strapi 里有定时发布 cron：**`reviewState=approved` 的草稿会被每分钟自动重新发布**。

后果：在后台点「取消发布」会被这个 cron 回滚，看起来像没生效。
真要下架文章只能**删除**，或先把 `reviewState` 改掉。

---

## 5. 备份

`deploy/backup-db.sh`，每天 02:45：

- 在 `jinrichigua-postgres-1` 容器内 `pg_dump`（在线热备），gzip 落宿主 `data/backups/`
- 保留 7 天，`find -mtime +7 -delete` 轮转
- 落盘后校验非空 + `gzip -t` 完整性，失败则删除产物并 `exit 1`
- 数据库凭证从 `deploy/.env` 读，`PGPASSWORD` 只存在于 `docker exec` 环境内，不落盘

`data/backups/` 已 gitignore——备份是运维产物，不入库。

**未做**：备份没有异地副本，全在本机。机器挂了备份一起没。

---

## 6. 机密清单

| 文件 | 用途 | 入库？ |
|---|---|---|
| `deploy/.env` | Strapi 密钥 / PG 密码 / R2 / Cloudflare 运维凭证 | 否 |
| `apps/web/.env.local` | 前台 SITE_URL / Token / Turnstile / GA | 否 |
| `scripts/hot-sync/.env` | Strapi API Token / 生成后端配置 | 否 |

三者都有对应的 `.env.example` 模板，键名齐全。**真实值只在这台机器上，没有别处副本。**

跨文件必须一致的共享密钥（改一个就要改另一个）：

- `FRIEND_TRACK_SECRET` —— `deploy/.env` ↔ `apps/web/.env.local`
- `WEB_REVALIDATE_TOKEN`（后台）↔ `REVALIDATE_TOKEN`（前台）

---

## 7. 常见排查

| 现象 | 先看这里 |
|---|---|
| 前台 502 | `pm2 list` 看 `jrcg-web` 是否 online；`pm2 logs jrcg-web` |
| 改了后台代码没生效 | 镜像没重建，见 §3.2 |
| 文章「取消发布」后又出现 | Strapi 定时发布 cron，见 §4.3 |
| 热榜没出新稿 | `pm2 logs jrcg-hot-sync`；检查 `scripts/hot-sync/state.json` 与 `.run.lock` |
| 图片 403 | R2 防盗链 WAF 规则，检查 Referer 白名单 |
| `pm2 list` 里 hot-sync 是 stopped | 正常，见 §2.1 |
