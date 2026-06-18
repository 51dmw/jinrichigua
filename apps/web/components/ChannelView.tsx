import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getArticlesByChannel, getChannelBySlug, getGlobal } from '@/lib/strapi';
import { resolveMetadata, itemListJsonLd } from '@/lib/seo';
import { ArticleCard } from './ArticleCard';
import { Breadcrumb } from './Breadcrumb';
import { JsonLd } from './JsonLd';
import { AdSlotBanner } from './AdSlotBanner';
import { AdAnchor } from './AdAnchor';
import { HotList } from './HotList';
import { TagCloud } from './TagCloud';
import { Pagination, pageHref, MAX_LIST_PAGES } from './Pagination';

export const CHANNEL_PAGE_SIZE = 20;

/** 频道列表页 metadata（含分页标题 + 路径式 canonical 自指）。 */
export async function channelMeta(channelSlug: string, page: number): Promise<Metadata> {
  const [channel, global, { total }] = await Promise.all([
    getChannelBySlug(channelSlug),
    getGlobal(),
    getArticlesByChannel(channelSlug, 1, 1),
  ]);
  if (!channel) return {};
  const base = `/${channel.slug}`;
  const meta = resolveMetadata({
    seo: channel.seo,
    global,
    fallbackTitle: page > 1 ? `${channel.name} - 第 ${page} 页` : channel.name,
    fallbackDescription: channel.description,
    path: base,
    canonicalPath: pageHref(base, page),
  });
  // 空频道（无文章）→ noindex：频道是导航项，保留 200 可访问，但不收录薄内容
  if (total === 0) meta.robots = { index: false, follow: true };
  return meta;
}

/** 频道列表页渲染（基础路由与 /page/[n] 共用）。 */
export async function ChannelView({ channelSlug, page }: { channelSlug: string; page: number }) {
  if (page > MAX_LIST_PAGES) notFound(); // 翻页限深：更早内容走归档/sitemap（参考凤凰网）
  const channel = await getChannelBySlug(channelSlug);
  if (!channel) notFound();

  const { items, pageCount, total } = await getArticlesByChannel(
    channelSlug,
    page,
    CHANNEL_PAGE_SIZE,
  );
  if (page > 1 && items.length === 0) notFound();

  const base = `/${channel.slug}`;

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start lg:gap-5">
      <div className="min-w-0">
        <Breadcrumb
          items={[
            { name: '首页', path: '/' },
            { name: channel.name, path: base },
          ]}
        />
        <JsonLd
          data={itemListJsonLd(
            items.map((a) => ({
              name: a.title,
              path: `/${a.channel?.slug ?? channelSlug}/${a.slug}`,
            })),
            channel.name,
          )}
        />
        <h1 className="mb-2 border-l-4 border-brand pl-2 text-lg font-bold">{channel.name}</h1>

        {/* 频道简介（SEO，仅第 1 页展示，避免分页重复） */}
        {channel.description && page === 1 ? (
          <p className="mb-3 rounded-lg bg-white p-3 text-sm leading-6 text-gray-600">
            {channel.description}
          </p>
        ) : null}

        {/* 顶部横幅（列表上方） */}
        <AdSlotBanner slotKey="channel-top" />

        {items.length === 0 ? (
          <p className="rounded-lg bg-white p-6 text-center text-sm text-gray-500">
            该频道暂无文章。
          </p>
        ) : (
          <div className="divide-y divide-gray-100 rounded-lg bg-white px-3">
            {/* 第 6 条后插入信息流原生位（1:6 密度） */}
            {items.map((a, i) => [
              <ArticleCard
                key={a.documentId}
                article={a}
                variant="left-text-right-image"
                headingLevel={2}
              />,
              i === 5 ? <AdSlotBanner key="channel-mid" slotKey="channel-mid" /> : null,
            ])}
          </div>
        )}

        <Pagination
          basePath={base}
          page={page}
          pageCount={pageCount}
          total={total}
          maxPages={MAX_LIST_PAGES}
        />
      </div>

      <aside className="lg:sticky lg:top-16">
        <HotList channelSlug={channelSlug} title="频道热门" />
        <AdSlotBanner slotKey="channel-aside" />
        <TagCloud />
      </aside>
      <AdAnchor slotKey="channel-anchor" />
    </div>
  );
}
