import { getPopularTags } from '@/lib/strapi';
import { TagChip } from './TagChip';

/** 热门标签云（侧栏）：SEO 内链 + 内容发现。链接到 /tag/{slug}。 */
export async function TagCloud({ limit = 12 }: { limit?: number }) {
  const tags = await getPopularTags(limit);
  if (tags.length === 0) return null;

  return (
    <section className="mb-6 rounded-lg bg-white p-3">
      <h2 className="mb-2 border-l-4 border-brand pl-2 text-base font-bold text-gray-900">
        热门标签
      </h2>
      <div className="flex flex-wrap gap-2">
        {tags.map((t) => (
          <TagChip key={t.documentId} slug={t.slug} name={t.name} />
        ))}
      </div>
    </section>
  );
}
