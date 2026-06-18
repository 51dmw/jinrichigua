import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import type { ArticleListItem } from 'shared';
import { getGlobal, getHotArticles, mediaUrl, imageAlt } from '@/lib/strapi';
import { resolveMetadata, itemListJsonLd } from '@/lib/seo';
import { Breadcrumb } from '@/components/Breadcrumb';
import { JsonLd } from '@/components/JsonLd';
import { AdSlotBanner } from '@/components/AdSlotBanner';
import { TagCloud } from '@/components/TagCloud';
import { CoverPlaceholder } from '@/components/CoverPlaceholder';

export const revalidate = 120; // ISR
export const dynamicParams = true;

export async function generateMetadata(): Promise<Metadata> {
  const global = await getGlobal();
  return resolveMetadata({
    global,
    fallbackTitle: '吃瓜热榜',
    fallbackDescription: '实时更新，一榜尽览今日全网吃瓜热点与热搜。',
    path: '/hot',
  });
}

function formatHeat(n?: number | null): string {
  const v = n ?? 0;
  if (v >= 10000) return `${(v / 10000).toFixed(v >= 100000 ? 0 : 1)}万`;
  return String(v);
}

function HotRow({ a, rank }: { a: ArticleListItem; rank: number }) {
  const cover = mediaUrl(a.cover);
  const href = `/${a.channel?.slug ?? 'news'}/${a.slug}`;
  const top = rank <= 3;
  return (
    <li>
      <Link href={href} className="flex gap-3 border-b border-gray-100 p-3 last:border-0">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`text-sm font-extrabold italic ${top ? 'text-brand' : 'text-gray-400'}`}
            >
              NO.{rank}
            </span>
            <span className="text-xs text-gray-400">{formatHeat(a.viewCount)}热度</span>
          </div>
          <h2 className="mt-1 line-clamp-1 font-bold text-gray-900">
            <span className="text-brand">#</span>
            {a.title}
          </h2>
          {a.summary ? (
            <p className="mt-1 line-clamp-2 text-sm text-gray-500">{a.summary}</p>
          ) : null}
          <div className="mt-1 text-xs text-gray-400">
            {a.channel?.name ?? ''} {a.source ? `· ${a.source}` : ''}
          </div>
        </div>
        <div className="relative aspect-[4/3] w-28 shrink-0 overflow-hidden rounded">
          {cover ? (
            <Image src={cover} alt={imageAlt(a.cover, a.title)} fill sizes="112px" className="object-cover" />
          ) : (
            <CoverPlaceholder wordmark={false} />
          )}
        </div>
      </Link>
    </li>
  );
}

export default async function HotPage() {
  const items = await getHotArticles(30);

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start lg:gap-5">
      <div className="min-w-0">
        <Breadcrumb
          items={[
            { name: '首页', path: '/' },
            { name: '吃瓜热榜', path: '/hot' },
          ]}
        />
        <JsonLd
          data={itemListJsonLd(
            items.map((a) => ({ name: a.title, path: `/${a.channel?.slug ?? 'news'}/${a.slug}` })),
            '吃瓜热榜',
          )}
        />
        {/* 顶部横幅 */}
        <AdSlotBanner slotKey="hot-top" />

        {/* 热榜 banner */}
        <div className="mb-3 overflow-hidden rounded-lg bg-gradient-to-b from-brand to-brand-dark px-6 py-7 text-center text-white">
          <h1 className="text-2xl font-extrabold tracking-wide">
            <span className="text-white/70">HOT</span> 吃瓜热榜
          </h1>
          <p className="mt-1 text-xs text-white/80">实时更新 · 一榜尽览全站热点</p>
        </div>

        {items.length === 0 ? (
          <p className="rounded-lg bg-white p-8 text-center text-sm text-gray-500">暂无榜单数据。</p>
        ) : (
          <ol className="rounded-lg bg-white">
            {items.map((a, i) => (
              <HotRow key={a.documentId} a={a} rank={i + 1} />
            ))}
          </ol>
        )}
      </div>

      <aside className="lg:sticky lg:top-16">
        <AdSlotBanner slotKey="hot-aside" />
        <TagCloud />
      </aside>
    </div>
  );
}
