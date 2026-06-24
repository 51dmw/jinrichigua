// 友链统计第2期：每日定时聚合 + 清理。
// 重活在 service（api::friend-link-daily-stat 的 aggregateDay/backfillMissing/cleanupOld，
// 可手动调 / 测试）；这里只做「编排 + 执行时机(tz)」。被 config/server.ts 合并进 cron.tasks。
const STAT_UID = 'api::friend-link-daily-stat.friend-link-daily-stat';

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
};

export default cronTasks;
