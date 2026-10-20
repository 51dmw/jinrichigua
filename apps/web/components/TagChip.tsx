import Link from 'next/link';

/**
 * 标签内链胶囊——全站统一（标签云 / 文章页 / 搜索页 / 信息页）。
 * 浅红底 + 品牌红字，与列表卡片上的胶囊同一套样式；hover 变实心红，强化"这是内链"的可点击感。
 */
export function TagChip({ slug, name }: { slug: string; name: string }) {
  return (
    <Link
      href={`/tag/${slug}`}
      className="inline-flex items-center rounded-full bg-brand/10 px-3 py-1 text-sm text-brand transition-colors hover:bg-brand hover:text-white"
    >
      {name}
    </Link>
  );
}
