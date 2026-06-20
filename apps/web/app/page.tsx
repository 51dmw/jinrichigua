import type { Metadata } from 'next';
import { getGlobal, getHomeBlocks } from '@/lib/strapi';
import { resolveMetadata } from '@/lib/seo';
import { HomeBlockSection } from '@/components/HomeBlockSection';
import { AdSlotBanner } from '@/components/AdSlotBanner';
import { AdAnchor } from '@/components/AdAnchor';
import { HotList } from '@/components/HotList';
import { TagCloud } from '@/components/TagCloud';

// ISR（§5：60–300s）。Next 要求 revalidate 为可静态分析的字面量，故此处硬编码。
export const revalidate = 120;
export const dynamicParams = true;

export async function generateMetadata(): Promise<Metadata> {
  const global = await getGlobal();
  return resolveMetadata({
    seo: global?.defaultSeo,
    global,
    // 首页 title 含核心关键词（避免过短，§4 SEO）；og:title 由 resolveMetadata 同步。
    fallbackTitle: '今日吃瓜 - 明星娱乐·网红爆料·社会大瓜实时热搜聚合',
    fallbackDescription: global?.defaultSeo?.metaDescription,
    path: '/',
  });
}

export default async function HomePage() {
  const [blocks, global] = await Promise.all([getHomeBlocks(), getGlobal()]);
  const siteName = global?.siteName ?? 'News Portal';

  if (blocks.length === 0) {
    return (
      <div className="rounded-lg bg-white p-8 text-center text-sm text-gray-500">
        暂无内容。请先在 Strapi 后台发布频道与文章（或等待首次启动的示例数据写入）。
      </div>
    );
  }

  return (
    // PC：两栏（左内容 + 右侧边栏热门）；H5：单栏，热门自然落到底部
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start lg:gap-5">
      {/* 唯一 h1（SEO，视觉隐藏，不影响版式） */}
      <h1 className="sr-only">{siteName} — 每日明星娱乐、网红爆料与全网热点吃瓜聚合</h1>
      <div className="min-w-0">
        <AdSlotBanner slotKey="home-top" />
        {/* 区块 + 穿插信息流原生位（密度约 1:N，避免农场感） */}
        {blocks.map((block, i) => [
          <HomeBlockSection key={block.channelSlug ?? block.title} block={block} first={i === 0} />,
          i === 0 ? <AdSlotBanner key="home-feed-1" slotKey="home-feed-1" /> : null,
          i === 2 ? <AdSlotBanner key="home-feed-2" slotKey="home-feed-2" /> : null,
        ])}

        {/* 站点简介（SEO：给首页补成段文本 + 主题关键词，后台 Global.homeIntro 驱动） */}
        {global?.homeIntro ? (
          <section className="mb-6 rounded-lg bg-white p-4">
            <h2 className="mb-2 border-l-4 border-brand pl-2 text-base font-bold text-gray-900">
              关于 {siteName}
            </h2>
            <p className="text-sm leading-7 text-gray-600">{global.homeIntro}</p>
          </section>
        ) : null}
      </div>
      <aside className="lg:sticky lg:top-16">
        <HotList />
        <TagCloud />
      </aside>
      {/* 移动端底部悬浮 */}
      <AdAnchor slotKey="home-anchor" />
    </div>
  );
}
