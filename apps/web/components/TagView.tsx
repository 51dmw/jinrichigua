import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getArticlesByTag, getGlobal, getTagBySlug } from '@/lib/strapi';
import { resolveMetadata, itemListJsonLd } from '@/lib/seo';
import { ArticleCard } from './ArticleCard';
import { Breadcrumb } from './Breadcrumb';
import { JsonLd } from './JsonLd';
import { Pagination, pageHref, MAX_LIST_PAGES } from './Pagination';
import { HotList } from './HotList';
import { AdSlotBanner } from './AdSlotBanner';
import { TagCloud } from './TagCloud';

export const TAG_PAGE_SIZE = 20;

export async function tagMeta(slug: string, page: number): Promise<Metadata> {
  const [tag, global] = await Promise.all([getTagBySlug(slug), getGlobal()]);
  const base = `/tag/${slug}`;
  const name = tag?.name ?? slug;
  // 标签聚合页原本只有「标签名」当标题，加上模板后缀不到 10 字，核心词覆盖太窄。
  // 统一补吃瓜/爆料/黑料/八卦这组核心词；长度按 SEO 规范 A-2（≤60 字符，含
  // titleTemplate 的「 | 今日吃瓜」后缀）控制，所以标签名只出现一次，不重复堆砌。
  const fallbackTitle =
    page > 1
      ? `${name}吃瓜爆料黑料汇总 - 第 ${page} 页`
      : `${name}最新吃瓜爆料 - 黑料八卦事件全记录`;
  // 标签量大无法逐个填描述：无 tag.description 时用模板兜底，保证每个标签页都有独特 meta。
  const baseDescription =
    tag?.description ??
    `今日吃瓜${name}专题，汇总${name}的最新吃瓜爆料、黑料内幕、八卦绯闻与热搜事件：` +
      `从事件起因、时间线梳理到当事人回应与网友热议，逐条追踪${name}相关的娱乐圈动态与最新进展。` +
      `本页按时间倒序收录全部${name}相关文章，每日更新，想第一时间知道又出了什么新瓜，收藏本页持续跟进。`;
  return resolveMetadata({
    seo: tag?.seo,
    global,
    fallbackTitle,
    // 翻页描述加页码，避免第 2~5 页与首页 meta description 完全重复
    fallbackDescription: page > 1 ? `${baseDescription}（第 ${page} 页）` : baseDescription,
    fallbackKeywords: [name, `${name}吃瓜`, `${name}爆料`, `${name}黑料`, `${name}八卦`, '吃瓜爆料'],
    path: base,
    canonicalPath: pageHref(base, page),
  });
}

export async function TagView({ slug, page }: { slug: string; page: number }) {
  if (page > MAX_LIST_PAGES) notFound(); // 翻页限深：更早内容走归档/sitemap（参考凤凰网）
  const [tag, { items, pageCount, total }] = await Promise.all([
    getTagBySlug(slug),
    getArticlesByTag(slug, page, TAG_PAGE_SIZE),
  ]);
  if (!tag) notFound();
  // 标签下无文章（如历史文章被删）→ 404，避免薄内容/软 404 页被收录
  if (total === 0) notFound();
  if (page > 1 && items.length === 0) notFound();
  const base = `/tag/${slug}`;
  const name = tag.name;

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start lg:gap-5">
      <div className="min-w-0">
        <Breadcrumb
          items={[
            { name: '首页', path: '/' },
            { name, path: base },
          ]}
        />
        <JsonLd
          data={itemListJsonLd(
            items.map((a) => ({ name: a.title, path: `/${a.channel?.slug ?? 'news'}/${a.slug}` })),
            `标签：${name}`,
            base,
          )}
        />
        <h1 className="mb-2 border-l-4 border-brand pl-2 text-lg font-bold">{name}</h1>

        {/* 标签简介（SEO：缓解聚合页薄内容） */}
        {tag.description ? (
          <p className="mb-3 rounded-lg bg-white p-3 text-sm leading-6 text-gray-600">
            {tag.description}
          </p>
        ) : null}

        {items.length === 0 ? (
          <p className="rounded-lg bg-white p-6 text-center text-sm text-gray-500">
            该标签暂无文章。
          </p>
        ) : (
          <div className="divide-y divide-gray-100 rounded-lg bg-white px-3">
            {items.map((a) => (
              <ArticleCard
                key={a.documentId}
                article={a}
                variant="left-text-right-image"
                headingLevel={2}
              />
            ))}
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
        <HotList tagSlug={slug} title="本标签热门" />
        <AdSlotBanner slotKey="tag-aside" />
        <TagCloud />
      </aside>
    </div>
  );
}
