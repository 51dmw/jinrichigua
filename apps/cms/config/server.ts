import friendLinkCron from './cron';

export default ({ env }) => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  // 公开 URL（反代 + Cloudflare TLS 终止）。admin 跳转/媒体绝对地址用它。
  url: env('URL', ''),
  // 信任反代的 X-Forwarded-* 头（Cloudflare→Nginx→Strapi），否则 https 重定向出错。
  proxy: true,
  app: {
    keys: env.array('APP_KEYS'),
  },
  // 发布 lifecycle 触发 webhook 时带上关联数据（§7 发布联动）
  webhooks: {
    populateRelations: env.bool('WEBHOOKS_POPULATE_RELATIONS', true),
  },
  // 定时任务（§6 定时发布）
  cron: {
    enabled: env.bool('CRON_ENABLED', true),
    tasks: {
      // 每分钟：把「已审核通过(approved) 且 publishAt 到点」但尚未发布的文章自动发布。
      '*/1 * * * *': async ({ strapi }: { strapi: any }) => {
        const UID = 'api::article.article';
        const now = new Date().toISOString();
        let due: Array<{ documentId: string }> = [];
        try {
          due = await strapi.documents(UID).findMany({
            status: 'draft',
            filters: { reviewState: 'approved', publishAt: { $lte: now } },
            fields: ['documentId'],
            pagination: { pageSize: 100 },
          });
        } catch (e) {
          strapi.log.warn(`[cron] query scheduled failed: ${(e as Error).message}`);
          return;
        }
        let count = 0;
        for (const d of due) {
          try {
            const pub = await strapi
              .documents(UID)
              .findOne({ documentId: d.documentId, status: 'published' });
            if (!pub) {
              await strapi.documents(UID).publish({ documentId: d.documentId });
              count += 1;
            }
          } catch (e) {
            strapi.log.warn(`[cron] publish ${d.documentId} failed: ${(e as Error).message}`);
          }
        }
        if (count > 0) strapi.log.info(`[cron] 定时发布 ${count} 篇`);
      },
      // 友链统计第2期：每日 Shanghai 01:30 聚合昨天 + 回补 + 清理 30 天前（详见 config/cron.ts）。
      ...friendLinkCron,
    },
  },
});
