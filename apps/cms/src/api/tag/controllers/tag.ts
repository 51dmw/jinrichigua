import { factories } from '@strapi/strapi';

const UID = 'api::tag.tag';

export default factories.createCoreController(UID, ({ strapi }) => ({
  /**
   * 批量创建标签。请求体 { text }（换行/逗号/顿号分隔）。
   * 权限通过 RBAC / API Token 控制（非公开写）；slug 由 tag lifecycle 自动生成。
   */
  async bulkCreate(ctx) {
    const text = (ctx.request.body as { text?: string } | undefined)?.text;
    if (!text || !String(text).trim()) {
      return ctx.badRequest('无内容：请粘贴标签名（每行一个，或用逗号/顿号分隔）');
    }
    const result = await strapi.service(UID).bulkCreate(text);
    ctx.body = result;
  },
}));
