import { factories } from '@strapi/strapi';

const UID = 'api::article.article';

/**
 * 审核流自定义动作（§6：草稿 → 待审 → 已发布）。
 * - submit ：编辑提交 → reviewState=pending
 * - approve：审核通过 → reviewState=approved 并发布（publish 受 register() 的发布守卫校验）
 * - reject ：审核退回 → reviewState=rejected（附退回意见 note）
 *
 * 路由见 routes/workflow.ts；权限通过 Strapi RBAC / API Token 控制。
 */
export default factories.createCoreController(UID, ({ strapi }) => ({
  // 内容 API 一律以「草稿」创建——发布只能经审核流 approve（§6 审核通过才发布）。
  // 注：后台 admin UI 走 content-manager 接口，不受此覆写影响，仍是标准草稿/发布 + RBAC + 发布守卫。
  async create(ctx) {
    const body = (ctx.request.body ?? {}) as { data?: Record<string, unknown> };
    const input = (await this.sanitizeInput(body.data ?? {}, ctx)) as Record<string, unknown>;

    const doc = await strapi.documents(UID).create({
      data: { ...input, reviewState: input.reviewState ?? 'draft' } as any,
      status: 'draft',
    });

    const sanitized = await this.sanitizeOutput(doc, ctx);
    return this.transformResponse(sanitized);
  },

  async submit(ctx) {
    const { id } = ctx.params;
    const doc = await strapi.documents(UID).update({
      documentId: id,
      data: { reviewState: 'pending' },
    });
    if (!doc) return ctx.notFound();
    ctx.body = { data: doc, message: '已提交，等待审核' };
  },

  async approve(ctx) {
    const { id } = ctx.params;
    const note = (ctx.request.body as { note?: string } | undefined)?.note ?? null;
    await strapi.documents(UID).update({
      documentId: id,
      data: { reviewState: 'approved', reviewNote: note },
    });
    const published = await strapi.documents(UID).publish({ documentId: id });
    ctx.body = { data: published, message: '审核通过，已发布' };
  },

  async reject(ctx) {
    const { id } = ctx.params;
    const note = (ctx.request.body as { note?: string } | undefined)?.note ?? null;
    const doc = await strapi.documents(UID).update({
      documentId: id,
      data: { reviewState: 'rejected', reviewNote: note },
    });
    if (!doc) return ctx.notFound();
    ctx.body = { data: doc, message: '已退回' };
  },

  // PV 自增（§M6）。直接经 knex 原子自增——同时作用于草稿与已发布两行（D&P 同 documentId），
  // 这样前台/热门/stats 读到的「已发布」viewCount 也即时反映；且绕过 lifecycle，不触发发布联动。
  async view(ctx) {
    const { id } = ctx.params;
    try {
      const knex = strapi.db.connection;
      const affected = await knex('articles').where({ document_id: id }).increment('view_count', 1);
      if (!affected) return ctx.notFound();
      const row = await knex('articles')
        .where({ document_id: id })
        .whereNotNull('published_at')
        .first('view_count');
      ctx.body = { data: { viewCount: row?.view_count ?? null } };
    } catch (e) {
      strapi.log.warn(`[view] ${(e as Error).message}`);
      ctx.status = 200;
      ctx.body = { data: { ok: false } };
    }
  },

  // 简易数据看板数据源（§M6 PV/热门）。UV 走 Yandex.Metrica（M4）。
  async stats(ctx) {
    const totalArticles = await strapi.documents(UID).count({ status: 'published' } as any);
    const all = await strapi.documents(UID).findMany({
      status: 'published',
      fields: ['viewCount'],
      pagination: { pageSize: 2000 },
    } as any);
    const totalViews = (all ?? []).reduce(
      (s: number, a: any) => s + (a.viewCount ?? 0),
      0,
    );
    const hot = await strapi.documents(UID).findMany({
      status: 'published',
      sort: 'viewCount:desc',
      fields: ['title', 'slug', 'viewCount'],
      populate: { channel: { fields: ['slug', 'name'] } },
      pagination: { pageSize: 10 },
    } as any);
    ctx.body = { data: { totalArticles, totalViews, hot } };
  },
}));
