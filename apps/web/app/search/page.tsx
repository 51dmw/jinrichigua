import type { Metadata } from 'next';
import Link from 'next/link';
import { getGlobal, getHotArticles, getPopularTags, searchArticles } from '@/lib/strapi';
import { resolveMetadata } from '@/lib/seo';
import { ArticleCard } from '@/components/ArticleCard';
import { Breadcrumb } from '@/components/Breadcrumb';
import { SearchBox } from '@/components/SearchBox';
import { AdSlotBanner } from '@/components/AdSlotBanner';
import { Pagination } from '@/components/Pagination';
import { TagChip } from '@/components/TagChip';

// 搜索结果动态渲染
export const dynamic = 'force-dynamic';

const SEARCH_PAGE_SIZE = 20;

type SP = Promise<{ q?: string; page?: string }>;

export async function generateMetadata({ searchParams }: { searchParams: SP }): Promise<Metadata> {
  const { q } = await searchParams;
  const global = await getGlobal();
  const meta = resolveMetadata({
    global,
    fallbackTitle: q ? `“${q}” 的搜索结果` : '站内搜索',
    fallbackDescription: q
      ? `“${q}” 的站内搜索结果 —— 在今日吃瓜查找明星娱乐、网红达人、社会大瓜等全网吃瓜内容。`
      : '在今日吃瓜站内搜索明星娱乐、网红达人、社会大瓜、爆料内幕等全网热点与爆料内容。',
    path: '/search',
    // 站内搜索结果页 MUST noindex（避免重复/低质页被索引）。
    // 必须在这里传入而非事后覆盖 —— resolveMetadata 要靠它决定不输出 hreflang（#57）。
    robots: { index: false, follow: true },
  });
  return meta;
}

export default async function SearchPage({ searchParams }: { searchParams: SP }) {
  const { q = '', page: pageParam } = await searchParams;
  const term = q.trim();
  const page = Math.max(1, Number(pageParam) || 1);
  // 有词 → 分页查结果（20/页）；无词 → 拉真实热门内容 + 热门标签（落地引导）
  const search = term
    ? await searchArticles(term, page, SEARCH_PAGE_SIZE)
    : { items: [], total: 0, pageCount: 0 };
  const results = search.items;
  const [hot, tags] = term ? [[], []] : await Promise.all([getHotArticles(12), getPopularTags(24)]);

  return (
    <div className="mx-auto w-full max-w-screen">
      <Breadcrumb
        items={[
          { name: '首页', path: '/' },
          { name: '搜索', path: '/search' },
        ]}
      />
      <h1 className="mb-3 border-l-4 border-brand pl-2 text-lg font-bold">站内搜索</h1>

      <div className="mb-4">
        <SearchBox initial={term} />
      </div>

      <AdSlotBanner slotKey="search-top" />

      {!term ? (
        <div className="space-y-4">
          {/* 热门搜索：真实热门内容（按浏览量），点击直达 */}
          {hot.length > 0 ? (
            <section className="rounded-lg bg-white p-4">
              <h2 className="mb-3 border-l-4 border-brand pl-2 text-base font-bold text-gray-900">
                热门搜索
              </h2>
              <ol className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
                {hot.map((a, i) => (
                  <li key={a.documentId}>
                    <Link
                      href={`/${a.channel?.slug ?? 'news'}/${a.slug}`}
                      className="flex items-center gap-2.5 py-1.5 text-gray-700 hover:text-brand"
                    >
                      <span
                        className={`w-4 shrink-0 text-center text-sm font-bold italic ${
                          i < 3 ? 'text-brand' : 'text-gray-500'
                        }`}
                      >
                        {i + 1}
                      </span>
                      <span className="line-clamp-1 text-sm">{a.title}</span>
                    </Link>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          {/* 往期更精彩 → 吃瓜热榜 */}
          <Link
            href="/hot"
            className="block rounded-lg bg-brand py-3 text-center text-sm font-bold text-white transition hover:bg-brand-dark"
          >
            往期更精彩 ›
          </Link>

          {/* 热门标签：真实标签，点击进标签页 */}
          {tags.length > 0 ? (
            <section className="rounded-lg bg-white p-4">
              <h2 className="mb-3 border-l-4 border-brand pl-2 text-base font-bold text-gray-900">
                热门标签
              </h2>
              <div className="flex flex-wrap gap-2">
                {tags.map((t) => (
                  <TagChip key={t.slug} slug={t.slug} name={t.name} />
                ))}
              </div>
            </section>
          ) : null}

          {hot.length === 0 && tags.length === 0 ? (
            <p className="rounded-lg bg-white p-6 text-center text-sm text-gray-500">
              输入关键词，搜索全站内容。
            </p>
          ) : null}
        </div>
      ) : results.length === 0 ? (
        <p className="rounded-lg bg-white p-6 text-center text-sm text-gray-500">
          未找到与「{term}」相关的内容。
        </p>
      ) : (
        <>
          <p className="mb-2 px-1 text-xs text-gray-500">
            「{term}」的结果 · 共 {search.total} 条
          </p>
          <div className="divide-y divide-gray-100 rounded-lg bg-white px-3">
            {results.map((a, i) => [
              <ArticleCard
                key={a.documentId}
                article={a}
                variant="left-text-right-image"
                headingLevel={2}
              />,
              i === 5 ? <AdSlotBanner key="search-feed" slotKey="search-feed" /> : null,
            ])}
          </div>
          <Pagination
            page={page}
            pageCount={search.pageCount}
            total={search.total}
            hrefFor={(p) =>
              `/search?q=${encodeURIComponent(term)}${p > 1 ? `&page=${p}` : ''}`
            }
          />
        </>
      )}
    </div>
  );
}
