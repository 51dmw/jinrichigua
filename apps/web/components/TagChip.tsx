import Link from 'next/link';

/**
 * 标签内链胶囊——全站统一（标签云 / 文章页 / 搜索页 / 信息页）。
 * 浅底 + 细边 = 明确可点；hover 变品牌色，强化"这是内链"的可点击感（SEO 内链 + UX）。
 */
export function TagChip({ slug, name }: { slug: string; name: string }) {
  return (
    <Link
      href={`/tag/${slug}`}
      className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-sm text-gray-600 transition-colors hover:border-brand/40 hover:bg-brand/10 hover:text-brand"
    >
      {name}
    </Link>
  );
}
