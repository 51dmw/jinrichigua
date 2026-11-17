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
import { CardMeta, CardTagRow } from '@/components/ArticleCard';

export const revalidate = 120; // ISR
export const dynamicParams = true;

export async function generateMetadata(): Promise<Metadata> {
  const global = await getGlobal();
  return resolveMetadata({
    global,
    fallbackTitle: '吃瓜热榜 - 今日全网热搜吃瓜事件排行',
    fallbackDescription:
      '今日吃瓜热榜：按站内阅读热度排行，一榜看尽明星娱乐、网红达人、社会大瓜等' +
      '全网热搜吃瓜事件，点进每条可查看事件始末与最新进展。',
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
    // 与 ArticleCard 左文右图同构：标题链接撑满整行，频道/作者/标签各自可点（<a> 不可嵌套）
    <li className="relative flex gap-3 border-b border-gray-100 p-3 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-extrabold italic ${top ? 'text-brand' : 'text-gray-500'}`}>
            NO.{rank}
          </span>
          <span className="text-xs text-gray-500">{formatHeat(a.viewCount)}热度</span>
        </div>
        <h2 className="mt-1 line-clamp-1 font-bold text-gray-900">
          <Link href={href} className="after:absolute after:inset-0">
            <span className="text-brand">#</span>
            {a.title}
          </Link>
        </h2>
        {a.summary ? <p className="mt-1 line-clamp-2 text-sm text-gray-500">{a.summary}</p> : null}
        <CardMeta article={a} className="mt-1" />
        <CardTagRow article={a} />
      </div>
      <div className="relative aspect-[4/3] w-28 shrink-0 overflow-hidden rounded">
        {cover ? (
          <Image src={cover} alt={imageAlt(a.cover, a.title)} fill sizes="112px" className="object-cover" />
        ) : (
          <CoverPlaceholder wordmark={false} />
        )}
      </div>
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
            '/hot',
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
