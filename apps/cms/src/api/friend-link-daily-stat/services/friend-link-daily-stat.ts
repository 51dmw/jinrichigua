import { factories } from '@strapi/strapi';

const STAT_UID = 'api::friend-link-daily-stat.friend-link-daily-stat';

// 数据保留窗口（天）：logs 与 daily_stat 都只留 30 天。
const RETENTION_DAYS = 30;
// 回补扫描窗口（天）：cron 漏跑时补近 N 天缺失的 daily_stat。
const BACKFILL_DAYS = 7;

// ── Asia/Shanghai 自然日工具 ──
// 用户面向中国：所有「日」边界按上海时区算，绝不用服务器(LA)时区。

/** 把某瞬间格式化为「上海当地」的 YYYY-MM-DD（en-CA 即 ISO 日期格式）。 */
function shanghaiDateStr(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** 在某个 YYYY-MM-DD 上加减天数，返回 YYYY-MM-DD（用 UTC 历法运算，避开时区漂移）。 */
function addDaysStr(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

/** 上海「昨天」的 YYYY-MM-DD。 */
function shanghaiYesterday(now: Date): string {
  return addDaysStr(shanghaiDateStr(now), -1);
}

type AggRow = {
  link_id: number;
  in_pv: string | number;
  in_uv: string | number;
  out_pv: string | number;
  out_uv: string | number;
};

/**
 * 聚合某「上海自然日」的原始日志为日统计，幂等（先删该日已有行再插）。
 * @param targetDate 上海日期 'YYYY-MM-DD'
 * @returns { date, links } links=写入的友链行数
 */
async function aggregateDay(strapi: any, targetDate: string) {
  const knex = strapi.db.connection;

  // 排除爬虫；按上海自然日切边界（created_at 是 timestamptz）。
  const result = await knex.raw(
    `
    SELECT link_id,
      COUNT(*) FILTER (WHERE type = 'in')                  AS in_pv,
      COUNT(DISTINCT ip_hash) FILTER (WHERE type = 'in')   AS in_uv,
      COUNT(*) FILTER (WHERE type = 'out')                 AS out_pv,
      COUNT(DISTINCT ip_hash) FILTER (WHERE type = 'out')  AS out_uv
    FROM friend_link_logs
    WHERE is_bot = false
      AND (created_at AT TIME ZONE 'Asia/Shanghai')::date = ?
    GROUP BY link_id
    `,
    [targetDate],
  );
  const rows: AggRow[] = result.rows ?? result;

  // 幂等：先删该日已有的 daily_stat（防 cron 重跑 / 手动重跑产生重复）。
  await strapi.db.query(STAT_UID).deleteMany({ where: { date: targetDate } });

  let written = 0;
  for (const r of rows) {
    // 友链当前值快照（被删后统计仍可读）。
    const link = await knex('friend_links')
      .where({ id: r.link_id })
      .first('name', 'domain', 'code');

    await strapi.documents(STAT_UID).create({
      data: {
        date: targetDate,
        linkId: r.link_id,
        name: link?.name ?? null,
        domain: link?.domain ?? null,
        code: link?.code ?? null,
        refInPv: Number(r.in_pv) || 0,
        refInUv: Number(r.in_uv) || 0,
        refOutPv: Number(r.out_pv) || 0,
        refOutUv: Number(r.out_uv) || 0,
      },
    });
    written += 1;
  }

  strapi.log.info(`[friend-stat] aggregated ${targetDate}: ${written} link(s)`);
  return { date: targetDate, links: written };
}

/**
 * 回补：扫描近 N 天 logs 里出现过、但还没有 daily_stat 的上海日期，各补聚合一次。
 * 防 cron 漏跑丢数据。aggregateDay 本身幂等，重复补也安全。
 */
async function backfillMissing(strapi: any, days = BACKFILL_DAYS) {
  const knex = strapi.db.connection;
  const result = await knex.raw(
    `
    SELECT DISTINCT (created_at AT TIME ZONE 'Asia/Shanghai')::date::text AS d
    FROM friend_link_logs
    WHERE is_bot = false
      AND created_at >= now() - (? || ' days')::interval
    ORDER BY d
    `,
    [String(days)],
  );
  const dates: string[] = (result.rows ?? result).map((r: { d: string }) => r.d);

  let filled = 0;
  for (const d of dates) {
    const existing = await strapi.db.query(STAT_UID).count({ where: { date: d } });
    if (existing > 0) continue;
    await aggregateDay(strapi, d);
    filled += 1;
  }
  if (filled > 0) strapi.log.info(`[friend-stat] backfilled ${filled} missing day(s)`);
  return { filled };
}

/**
 * 清理：删 30 天前的原始日志与日统计。
 *  - friend_link_logs：created_at < now() - 30 天；
 *  - friend_link_daily_stat：date < (上海今天 - 30 天)。
 */
async function cleanupOld(strapi: any) {
  const knex = strapi.db.connection;

  const delLogs = await knex('friend_link_logs')
    .where('created_at', '<', knex.raw(`now() - (? || ' days')::interval`, [String(RETENTION_DAYS)]))
    .del();

  const cutoff = addDaysStr(shanghaiDateStr(new Date()), -RETENTION_DAYS);
  const delStats = await strapi.db.query(STAT_UID).deleteMany({ where: { date: { $lt: cutoff } } });
  const delStatsCount = typeof delStats === 'number' ? delStats : delStats?.count ?? 0;

  strapi.log.info(
    `[friend-stat] cleanup: logs -${delLogs}, daily_stat -${delStatsCount} (cutoff < ${cutoff})`,
  );
  return { delLogs, delStats: delStatsCount, cutoff };
}

export default factories.createCoreService(STAT_UID, ({ strapi }) => ({
  /** 聚合指定上海日期（手动 / 测试 / cron 共用）。 */
  aggregateDay: (targetDate: string) => aggregateDay(strapi, targetDate),
  /** 回补近 N 天缺失的 daily_stat。 */
  backfillMissing: (days?: number) => backfillMissing(strapi, days),
  /** 清理 30 天前的 logs 与 daily_stat。 */
  cleanupOld: () => cleanupOld(strapi),
  /** 上海「昨天」。 */
  shanghaiYesterday: () => shanghaiYesterday(new Date()),

  /**
   * cron 每日编排：聚合昨天(上海) → 回补 → 清理。每步独立 try/catch，失败只告警不崩。
   */
  async runDaily() {
    const yesterday = shanghaiYesterday(new Date());
    try {
      await aggregateDay(strapi, yesterday);
    } catch (e) {
      strapi.log.warn(`[friend-stat] aggregate ${yesterday} failed: ${(e as Error).message}`);
    }
    try {
      await backfillMissing(strapi, BACKFILL_DAYS);
    } catch (e) {
      strapi.log.warn(`[friend-stat] backfill failed: ${(e as Error).message}`);
    }
    try {
      await cleanupOld(strapi);
    } catch (e) {
      strapi.log.warn(`[friend-stat] cleanup failed: ${(e as Error).message}`);
    }
  },
}));
