import Image from 'next/image';
import Link from 'next/link';
import { getArticlesByChannel, mediaUrl, imageAlt } from '@/lib/strapi';
import { CoverPlaceholder } from './CoverPlaceholder';

/**
 * 侧栏「频道最新」模块：取某频道最新内容，左图右标题列表式，无「更多」跳转。
 * 标题用 h2（小节级别，配合文章页 h1 → h2 不跳级）；列表项不做标题，避免污染大纲。
 */
export async function ChannelLatest({
  channelSlug,
  title,
  limit = 8,
  excludeSlug,
}: {
  channelSlug: string;
  title: string;
  limit?: number;
  /** 排除某篇（如文章页排除当前文章，避免侧栏出现自己） */
  excludeSlug?: string;
}) {
  const { items: raw } = await getArticlesByChannel(channelSlug, 1, excludeSlug ? limit + 1 : limit);
  const items = (excludeSlug ? raw.filter((a) => a.slug !== excludeSlug) : raw).slice(0, limit);
  if (items.length === 0) return null;

  return (
    <section className="mb-6 rounded-lg bg-white p-3">
      <h2 className="mb-2 border-l-4 border-brand pl-2 text-base font-bold text-gray-900">{title}</h2>
      <ul className="divide-y divide-gray-100">
        {items.map((a) => {
          const url = mediaUrl(a.cover);
          return (
            <li key={a.documentId}>
              <Link
                href={`/${a.channel?.slug ?? channelSlug}/${a.slug}`}
                className="flex items-stretch gap-2.5 py-2.5"
              >
                <div className="relative aspect-[4/3] w-[5.5rem] shrink-0 overflow-hidden rounded">
                  {url ? (
                    <Image
                      src={url}
                      alt={imageAlt(a.cover, a.title)}
                      fill
                      sizes="88px"
                      className="object-cover"
                    />
                  ) : (
                    <CoverPlaceholder wordmark={false} />
                  )}
                </div>
                <span className="line-clamp-2 flex-1 self-center text-sm leading-snug text-gray-800">
                  {a.title}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
