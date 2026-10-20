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
import { Pagination, pageHref, deepPageRobots } from './Pagination';

export const CHANNEL_PAGE_SIZE = 20;

/**
 * 频道首页 SEO 标题（不含「 | 站名」后缀，由 titleTemplate 追加）。
 * 后台 channel.seo.metaTitle 优先；这里按频道主题补核心词，避免只有「频道名 | 站名」11 个字。
 * 新增频道没配时走 channelTitle() 的通用兜底。
 */
const CHANNEL_TITLES: Record<string, string> = {
  star: '明星娱乐 - 明星绯闻、恋情、塌房与综艺八卦最新爆料',
  influencer: '网红达人 - 主播博主翻车、撕番与带货内幕最新爆料',
  society: '社会大瓜 - 民生热点、维权现场与奇葩新闻最新进展',
  inside: '爆料内幕 - 行业黑幕与知情人爆料，事件来龙去脉梳理',
  dirt: '黑料档案 - 人物黑历史与争议事件始末归档',
  love: '情感婚恋 - 明星恋情、离婚出轨与豪门恩怨八卦',
  sports: '体育吃瓜 - 球星绯闻、转会风波与赛场争议热点',
  campus: '校园热议 - 高校趣闻、师生热点与考试升学话题',
  oversea: '海外吃瓜 - 欧美日韩明星动态与国际名人八卦',
  video: '吃瓜视频 - 热点事件现场视频与名场面回放',
  history: '历史旧瓜 - 经典热搜事件回顾与名人往事盘点',
};

function channelTitle(slug: string, name: string): string {
  return CHANNEL_TITLES[slug] ?? `${name} - 最新吃瓜热点与爆料汇总`;
}

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
    fallbackTitle: page > 1 ? `${channel.name} - 第 ${page} 页` : channelTitle(channel.slug, channel.name),
    // 后台频道简介约 40 字，补一句栏目说明到 ~80 字；翻页加页码，避免与第 1 页 description 重复
    fallbackDescription:
      `${channel.description ?? `${channel.name}最新热点与爆料。`}` +
      `本栏目按发布时间倒序收录全部${channel.name}文章，共 ${total} 篇，每日随全网热搜持续更新。` +
      (page > 1 ? `（第 ${page} 页）` : ''),
    path: base,
    canonicalPath: pageHref(base, page),
    robots: deepPageRobots(page),
  });
  // 空频道（无文章）→ noindex：频道是导航项，保留 200 可访问，但不收录薄内容
  if (total === 0) meta.robots = { index: false, follow: true };
  return meta;
}

/** 频道列表页渲染（基础路由与 /page/[n] 共用）。 */
export async function ChannelView({ channelSlug, page }: { channelSlug: string; page: number }) {
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
            base,
          )}
        />
        <h1 className="mb-2 border-l-4 border-brand pl-2 text-lg font-bold">
          {page > 1 ? `${channel.name} - 第 ${page} 页` : channel.name}
        </h1>

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
                showTags
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
