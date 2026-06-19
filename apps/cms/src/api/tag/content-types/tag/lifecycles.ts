/**
 * 标签 lifecycle —— 自动生成「SEO 友好 slug」。
 * - 中文名 → 拼音连写（与现有标签风格一致：吃瓜→chigua、塌房→tafang）；
 * - 英文/数字 → 直接保留，统一转小写（Hot News→hot-news）；
 * - 非字母数字一律转连字符并去重首尾；
 * - 同音/重名自动加数字后缀去重（时事、时势 → shishi、shishi-2）。
 * 这样「批量生产标签只给名称」即可，文章里新建中文标签也能正常出路径。
 */
import { pinyin } from 'pinyin-pro';

const CJK = /[一-鿿]+/g;

/** 名称/原始 slug → 规范化 slug（拼音连写 + 全小写 + 连字符）。 */
function toSlug(input?: string | null): string {
  if (!input) return '';
  // 把每段连续中文转成拼音并连写，其余字符原样保留
  const converted = String(input).replace(CJK, (run) =>
    pinyin(run, { toneType: 'none', type: 'array' }).join(''),
  );
  return converted
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** 保证 slug 唯一：撞库则加 -2 / -3 … 后缀（排除自身）。 */
async function uniqueSlug(base: string, selfId: number | null): Promise<string> {
  const root = base || 'tag';
  let slug = root;
  let n = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const hit = await strapi.db
      .query('api::tag.tag')
      .findOne({ where: { slug }, select: ['id'] });
    if (!hit || hit.id === selfId) return slug;
    n += 1;
    slug = `${root}-${n}`;
  }
}

export default {
  async beforeCreate(event: any) {
    const data = event.params?.data ?? {};
    // 优先用显式 slug（规范化后），为空则按名称自动生成
    const base = toSlug(data.slug) || toSlug(data.name);
    data.slug = await uniqueSlug(base, null);
  },

  async beforeUpdate(event: any) {
    const data = event.params?.data ?? {};
    const selfId = (event.params?.where?.id as number) ?? null;
    // 仅在改了 name 或动了 slug 时重算，避免无谓改动破坏已有 URL
    if (data.name != null || data.slug != null) {
      const base = toSlug(data.slug) || toSlug(data.name);
      if (base) data.slug = await uniqueSlug(base, selfId);
    }
  },
};
