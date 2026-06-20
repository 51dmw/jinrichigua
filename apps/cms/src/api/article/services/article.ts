import { factories } from '@strapi/strapi';

const TAG_UID = 'api::tag.tag';
const MIN_NAME_LEN = 2; // 跳过单字标签，避免"瓜""红"满篇命中噪音
const MATCH_LIMIT = 10; // 单次匹配命中上限
const TOTAL_CAP = 12; // 合并现有后总标签上限

type MatchedTag = { documentId: string; name: string; count: number };

export default factories.createCoreService('api::article.article', ({ strapi }) => ({
  /**
   * 从文章正文匹配标签库（tags 集合）里名字出现在正文中的标签。
   * 规则（§一）：
   *   - name 长度 < 2 跳过；
   *   - count = text.split(name).length - 1，> 0 命中；
   *   - 按 count 降序、其次 name 长度降序排序，取前 10；
   *   - 与现有 tags 合并去重（只增不覆盖），合并后 ≤ 12。
   * @returns matched 命中标签（前10）；finalTagIds 合并去重封顶后的最终 documentId 列表。
   */
  async matchTagsFromContent(
    content: string | null | undefined,
    existingTagIds: string[] = [],
  ): Promise<{ matched: MatchedTag[]; finalTagIds: string[] }> {
    const existing = [...new Set(existingTagIds)];
    const text = (content ?? '').toLowerCase();
    if (!text.trim()) {
      return { matched: [], finalTagIds: existing.slice(0, TOTAL_CAP) };
    }

    const tags = await strapi.documents(TAG_UID).findMany({
      fields: ['name'],
      pagination: { pageSize: 1000 },
    } as any);

    const hits: MatchedTag[] = [];
    for (const t of (tags ?? []) as Array<{ documentId: string; name?: string }>) {
      const name = (t.name ?? '').trim();
      if (name.length < MIN_NAME_LEN) continue;
      const count = text.split(name.toLowerCase()).length - 1;
      if (count > 0) hits.push({ documentId: t.documentId, name, count });
    }
    hits.sort((a, b) => b.count - a.count || b.name.length - a.name.length);
    const matched = hits.slice(0, MATCH_LIMIT);

    // 合并：现有标签在前（不覆盖），新增命中按序补足，去重，封顶 12。
    const seen = new Set(existing);
    const finalTagIds = [...existing];
    for (const m of matched) {
      if (finalTagIds.length >= TOTAL_CAP) break;
      if (!seen.has(m.documentId)) {
        finalTagIds.push(m.documentId);
        seen.add(m.documentId);
      }
    }
    return { matched, finalTagIds };
  },
}));
