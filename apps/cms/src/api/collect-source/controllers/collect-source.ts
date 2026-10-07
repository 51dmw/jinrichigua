import { factories } from '@strapi/strapi';

const UID = 'api::collect-source.collect-source';

export default factories.createCoreController(UID, ({ strapi }) => ({
  /**
   * 请求试抓：只写 testRequestedAt。CMS 在容器里够不到宿主机上的采集脚本，
   * 由 scripts/collect 下一轮（PM2 每 15 分钟）读到后试抓一条，结果写回 lastTestResult。
   */
  async requestTest(ctx) {
    const { documentId } = ctx.params;
    const source: any = await strapi.documents(UID).findOne({ documentId, fields: ['name'] } as any);
    if (!source) return ctx.notFound('采集源不存在');
    const at = new Date().toISOString();
    await strapi.documents(UID).update({ documentId, data: { testRequestedAt: at } as any });
    ctx.body = { data: { testRequestedAt: at }, message: '已请求试抓，15 分钟内出结果' };
  },
}));
