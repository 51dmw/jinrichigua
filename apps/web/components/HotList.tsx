import Link from 'next/link';
import { getHotArticles } from '@/lib/strapi';

/** 热门排行（§M6）：按 viewCount 倒序，带名次。可传 channelSlug 显示「频道热门」。 */
export async function HotList({
  limit = 8,
  channelSlug,
  tagSlug,
  title = '热门排行',
}: {
  limit?: number;
  channelSlug?: string;
  tagSlug?: string;
  title?: string;
}) {
  const items = await getHotArticles(limit, { channelSlug, tagSlug });
  if (items.length === 0) return null;

  return (
    <section className="mb-6 rounded-lg bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="border-l-4 border-brand pl-2 text-base font-bold text-gray-900">{title}</h2>
        <Link href="/hot" className="text-xs text-gray-500 hover:text-brand">
          更多 ›
        </Link>
      </div>
      <ol className="divide-y divide-gray-100">
        {items.map((a, i) => (
          <li key={a.documentId}>
            <Link
              href={`/${a.channel?.slug ?? 'news'}/${a.slug}`}
              className="flex items-center gap-3 py-2"
            >
              <span
                className={`w-5 shrink-0 text-center text-sm font-bold ${
                  i < 3 ? 'text-brand' : 'text-gray-500'
                }`}
              >
                {i + 1}
              </span>
              <span className="line-clamp-1 flex-1 text-[15px] text-gray-900">{a.title}</span>
              {typeof a.viewCount === 'number' ? (
                <span className="shrink-0 text-xs text-gray-500">{a.viewCount}</span>
              ) : null}
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
