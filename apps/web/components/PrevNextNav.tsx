import Link from 'next/link';
import type { ArticleListItem } from 'shared';

function href(a: ArticleListItem): string {
  return `/${a.channel?.slug ?? 'news'}/${a.slug}`;
}

/** 上一篇 / 下一篇（同频道按发布时间相邻）。增加站内留存与抓取深度。 */
export function PrevNextNav({
  prev,
  next,
}: {
  prev: ArticleListItem | null;
  next: ArticleListItem | null;
}) {
  if (!prev && !next) return null;
  return (
    <nav className="mt-4 grid gap-2 sm:grid-cols-2" aria-label="上下篇导航">
      {prev ? (
        <Link
          href={href(prev)}
          rel="prev"
          className="rounded-lg bg-white p-3 hover:bg-gray-50"
        >
          <div className="mb-0.5 text-xs text-gray-400">‹ 上一篇</div>
          <div className="line-clamp-1 text-sm font-medium text-gray-800">{prev.title}</div>
        </Link>
      ) : (
        <span className="hidden sm:block" />
      )}
      {next ? (
        <Link
          href={href(next)}
          rel="next"
          className="rounded-lg bg-white p-3 text-right hover:bg-gray-50"
        >
          <div className="mb-0.5 text-xs text-gray-400">下一篇 ›</div>
          <div className="line-clamp-1 text-sm font-medium text-gray-800">{next.title}</div>
        </Link>
      ) : (
        <span className="hidden sm:block" />
      )}
    </nav>
  );
}
