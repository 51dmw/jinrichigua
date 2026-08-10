// 友链统计第2期：每日定时聚合 + 清理。
// 重活在 service（api::friend-link-daily-stat 的 aggregateDay/backfillMissing/cleanupOld，
// 可手动调 / 测试）；这里只做「编排 + 执行时机(tz)」。被 config/server.ts 合并进 cron.tasks。
const STAT_UID = 'api::friend-link-daily-stat.friend-link-daily-stat';

// ── IndexNow 兜底扫描 ──
// 文章发布时 lifecycle 已经即时 ping 过前台（秒级），这里是第二道：
// 前台重启、网络抖动、IndexNow 返回非 2xx 都会让即时那次悄无声息地丢掉。
// 游标存在 plugin store，只有提交成功才推进；失败则原地不动，下一轮重来 → 不会漏。
// 重复提交由前台的去重窗口（apps/web/lib/indexnow.ts）收敛，不会真的重复发出去。
const ARTICLE_UID = 'api::article.article';
const CURSOR_KEY = 'lastPublishedAt';
/** 单轮最多补推的篇数（按 publishedAt 升序取，取不完下一轮接着来）。 */
const SWEEP_BATCH = 200;
/** 首次运行（没有游标）时的回看窗口，避免第一轮把全站历史都扫出来。 */
const FIRST_RUN_LOOKBACK_MS = 2 * 60 * 60 * 1000;

async function sweepIndexNow(strapi: any): Promise<void> {
  const base = process.env.WEB_REVALIDATE_URL;
  const token = process.env.WEB_REVALIDATE_TOKEN;
  if (!base || !token) return;

  const store = strapi.store({ type: 'plugin', name: 'indexnow' });
  const cursor: string =
    (await store.get({ key: CURSOR_KEY })) ??
    new Date(Date.now() - FIRST_RUN_LOOKBACK_MS).toISOString();

  const docs = await strapi.documents(ARTICLE_UID).findMany({
    status: 'published',
    filters: { publishedAt: { $gt: cursor } },
    fields: ['slug', 'publishedAt'],
    populate: { channel: { fields: ['slug'] } },
    sort: 'publishedAt:asc',
    pagination: { pageSize: SWEEP_BATCH },
  });
  if (!docs?.length) return;

  const newest = docs[docs.length - 1]?.publishedAt;
  const paths = docs
    .filter((d: any) => d.channel?.slug && d.slug)
    .map((d: any) => `/${d.channel.slug}/${d.slug}`);

  // 全都缺频道（理论上不该发生）：也要推进游标，否则会卡在同一批上反复空转。
  if (paths.length === 0) {
    if (newest) await store.set({ key: CURSOR_KEY, value: newest });
    strapi.log.warn(`[cron] IndexNow 兜底：${docs.length} 篇取不到频道，已跳过`);
    return;
  }

  const res = await fetch(new URL('/api/indexnow', base).toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ paths }),
    redirect: 'manual',
  });
  if (!res.ok) {
    // 不推进游标：这批下一轮重来
    strapi.log.warn(`[cron] IndexNow 兜底提交失败：HTTP ${res.status}，游标保持 ${cursor}`);
    return;
  }
  const body: any = await res.json().catch(() => ({}));
  if (newest) await store.set({ key: CURSOR_KEY, value: newest });
  strapi.log.info(
    `[cron] IndexNow 兜底：${paths.length} 条送检，实推 ${body?.submitted ?? '?'} 条` +
      `（去重跳过 ${body?.skipped ?? '?'}），游标 → ${newest}`,
  );
}

const cronTasks = {
  // ⭐ 上海时区每日 01:30 触发，聚合「昨天(上海)」那一天。
  // 即便 tz 选项失效，handler 内 runDaily 仍显式按上海算昨天，目标日期始终正确。
  'friend-link-daily-stat': {
    task: async ({ strapi }: { strapi: any }) => {
      try {
        await strapi.service(STAT_UID).runDaily();
      } catch (e) {
        strapi.log.warn(`[cron] friend-link daily stat failed: ${(e as Error).message}`);
      }
    },
    options: { rule: '30 1 * * *', tz: 'Asia/Shanghai' },
  },

  'indexnow-sweep': {
    task: async ({ strapi }: { strapi: any }) => {
      try {
        await sweepIndexNow(strapi);
      } catch (e) {
        strapi.log.warn(`[cron] IndexNow 兜底扫描异常：${(e as Error).message}`);
      }
    },
    options: { rule: '*/5 * * * *' },
  },
};

export default cronTasks;
