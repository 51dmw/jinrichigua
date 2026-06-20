import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getArticlesByMonth, getGlobal } from '@/lib/strapi';
import { resolveMetadata, itemListJsonLd } from '@/lib/seo';
import { ArticleCard } from './ArticleCard';
import { Breadcrumb } from './Breadcrumb';
import { JsonLd } from './JsonLd';
import { HotList } from './HotList';
import { TagCloud } from './TagCloud';
import { Pagination, pageHref } from './Pagination';

export const ARCHIVE_PAGE_SIZE = 20;

/** 校验 year/month，非法返回 null。 */
export function parseYearMonth(y: string, m: string): { year: number; month: number } | null {
  const year = Number(y);
  const month = Number(m);
  if (!Number.isInteger(year) || year < 2000 || year > 2999) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year, month };
}

export async function archiveMonthMeta(year: number, month: number, page: number): Promise<Metadata> {
  const global = await getGlobal();
  const base = `/archive/${year}/${month}`;
  const label = `${year} 年 ${month} 月`;
  return resolveMetadata({
    global,
    fallbackTitle: page > 1 ? `${label}文章归档 - 第 ${page} 页` : `${label}文章归档`,
    fallbackDescription: `${label}发布的全部文章归档。`,
    path: base,
    canonicalPath: pageHref(base, page),
  });
}

export async function ArchiveMonthView({
  year,
  month,
  page,
}: {
  year: number;
  month: number;
  page: number;
}) {
  const { items, pageCount, total } = await getArticlesByMonth(year, month, page, ARCHIVE_PAGE_SIZE);
  if (total === 0) notFound(); // 空月份 → 404，避免软薄内容
  if (page > 1 && items.length === 0) notFound();

  const base = `/archive/${year}/${month}`;
  const label = `${year} 年 ${month} 月`;

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start lg:gap-5">
      <div className="min-w-0">
        <Breadcrumb
          items={[
            { name: '首页', path: '/' },
            { name: '文章归档', path: '/archive' },
            { name: label, path: base },
          ]}
        />
        <JsonLd
          data={itemListJsonLd(
            items.map((a) => ({ name: a.title, path: `/${a.channel?.slug ?? 'news'}/${a.slug}` })),
            `${label}文章归档`,
          )}
        />
        <h1 className="mb-2 border-l-4 border-brand pl-2 text-lg font-bold">{label} · 文章归档</h1>
        <p className="mb-3 px-1 text-xs text-gray-500">共 {total} 篇</p>

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

        <Pagination basePath={base} page={page} pageCount={pageCount} total={total} />
      </div>

      <aside className="lg:sticky lg:top-16">
        <HotList title="热门排行" />
        <TagCloud />
      </aside>
    </div>
  );
}
