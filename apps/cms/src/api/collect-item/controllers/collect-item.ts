import { factories } from '@strapi/strapi';

const UID = 'api::collect-item.collect-item';
const ARTICLE_UID = 'api::article.article';

type Version = { title?: string; slug?: string; summary?: string; content?: string };

function normalizeSlug(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

async function uniqueArticleSlug(root: string): Promise<string> {
  let slug = root;
  for (let n = 2; n < 50; n++) {
    const hit = await strapi.db.query(ARTICLE_UID).findOne({ where: { slug }, select: ['id'] });
    if (!hit) return slug;
    slug = `${root}-${n}`;
  }
  return `${root}-${Date.now()}`;
}

export default factories.createCoreController(UID, ({ strapi }) => ({
  /**
   * 采纳：用最新一版成文生成正式文章草稿，并把条目标为已采纳。
   * 文章一律 reviewState=pending —— 定时发布任务会把 approved 的草稿每分钟自动发布，
   * 采纳不等于审核通过，必须再走一遍人工审核。
   */
  async adopt(ctx) {
    const { documentId } = ctx.params;
    const item: any = await strapi.documents(UID).findOne({
      documentId,
      populate: { source: { fields: ['name'] }, adoptedArticle: { fields: ['documentId'] } },
    } as any);
    if (!item) return ctx.notFound('采集草稿不存在');
    if (item.state === 'adopted' || item.adoptedArticle) return ctx.conflict('这条已经采纳过了');

    const versions: Version[] = Array.isArray(item.processed) ? item.processed : [];
    const latest = versions[versions.length - 1];
    if (!latest?.title || !latest?.content) return ctx.badRequest('这条还没有成文，不能采纳');

    const slug = await uniqueArticleSlug(normalizeSlug(latest.slug || '') || `collect-${item.id}`);
    const article = await strapi.documents(ARTICLE_UID).create({
      data: {
        title: latest.title,
        slug,
        summary: (latest.summary || item.summary || '').slice(0, 300),
        content: latest.content,
        source: `采集：${item.source?.name ?? '未知来源'}`,
        reviewState: 'pending',
        reviewNote: `来自采集草稿 ${documentId}（${item.sourceUrl}）`,
      } as any,
      status: 'draft',
    });

    await strapi.documents(UID).update({
      documentId,
      data: { state: 'adopted', adoptedArticle: article.documentId } as any,
    });

    ctx.body = { data: { article: article.documentId, slug }, message: '已采纳，已生成待审核文章' };
  },
}));
