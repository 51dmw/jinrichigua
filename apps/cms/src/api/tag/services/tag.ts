import { factories } from '@strapi/strapi';

const TAG_UID = 'api::tag.tag';
const MAX = 500; // 单次最多创建数

type BulkResult = {
  total: number;
  created: Array<{ name: string; slug: string }>;
  skipped: string[];
  truncated: boolean;
};

export default factories.createCoreService('api::tag.tag', ({ strapi }) => ({
  /**
   * 批量创建标签：解析文本 → 逐个 find-or-create。
   * 解析：按 换行 / 逗号(,，) / 顿号(、) 拆分 → trim → 去空 → 去重(保序)。
   * 已存在(按 name) → skipped；不存在 → document service 创建（触发 tag lifecycle 自动出 slug + 去重）。
   * 单次最多 500，超出截断并在返回标记 truncated。
   */
  async bulkCreate(text: string | null | undefined): Promise<BulkResult> {
    const raw = String(text ?? '')
      .split(/[\r\n,，、]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    // 去重保序
    const seen = new Set<string>();
    const names: string[] = [];
    for (const n of raw) {
      if (!seen.has(n)) {
        seen.add(n);
        names.push(n);
      }
    }

    let truncated = false;
    let list = names;
    if (list.length > MAX) {
      list = list.slice(0, MAX);
      truncated = true;
    }

    const created: Array<{ name: string; slug: string }> = [];
    const skipped: string[] = [];
    for (const name of list) {
      const exist = await strapi.db
        .query(TAG_UID)
        .findOne({ where: { name }, select: ['id'] });
      if (exist) {
        skipped.push(name);
        continue;
      }
      // 不传 slug：交给 tag lifecycle 自动生成拼音 slug + 同音去重。
      const doc = await strapi.documents(TAG_UID).create({ data: { name } } as any);
      created.push({ name: (doc as any).name, slug: (doc as any).slug });
    }

    return { total: list.length, created, skipped, truncated };
  },
}));
