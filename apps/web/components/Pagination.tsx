import Link from 'next/link';

/**
 * 列表页翻页深度上限（频道/标签）：仅保留最新若干页，更深的薄长尾不生成、不收录
 * （参考凤凰网做法）；更早内容走「文章归档」+ sitemap 发现。
 */
export const MAX_LIST_PAGES = 5;

/** SEO 友好分页路径：第 1 页 = basePath；第 N(≥2) 页 = basePath/page/N（不带查询参数）。 */
export function pageHref(basePath: string, page: number): string {
  return page <= 1 ? basePath : `${basePath}/page/${page}`;
}

const btn =
  'rounded border border-gray-200 bg-white px-3 py-1.5 text-gray-700 hover:bg-gray-50';
const dim = 'px-3 py-1.5 text-gray-300';

export function Pagination({
  basePath,
  page,
  pageCount,
  total,
  hrefFor,
  maxPages,
}: {
  /** 路径式分页（频道/标签/作者）：basePath/page/N。与 hrefFor 二选一。 */
  basePath?: string;
  page: number;
  pageCount: number;
  total: number;
  /** 自定义每页链接（如搜索的 ?q=...&page=N 查询式分页）。优先于 basePath。 */
  hrefFor?: (page: number) => string;
  /** 翻页深度上限（频道/标签传 MAX_LIST_PAGES）；超出不再出「下一页」。 */
  maxPages?: number;
}) {
  const effPageCount = maxPages ? Math.min(pageCount, maxPages) : pageCount;
  if (effPageCount <= 1) return null;
  const href = (p: number) => (hrefFor ? hrefFor(p) : pageHref(basePath ?? '/', p));
  const hasPrev = page > 1;
  const hasNext = page < effPageCount;
  return (
    <nav className="mt-4 flex items-center justify-between text-sm" aria-label="分页">
      {hasPrev ? (
        <Link href={href(page - 1)} rel="prev" className={btn}>
          ‹ 上一页
        </Link>
      ) : (
        <span className={dim}>‹ 上一页</span>
      )}
      <span className="text-xs text-gray-400">
        第 {page} / {effPageCount} 页 · 共 {total} 篇
      </span>
      {hasNext ? (
        <Link href={href(page + 1)} rel="next" className={btn}>
          下一页 ›
        </Link>
      ) : (
        <span className={dim}>下一页 ›</span>
      )}
    </nav>
  );
}
