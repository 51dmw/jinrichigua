import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { getArticlesByAuthor, getAuthorBySlug, getGlobal, mediaUrl, imageAlt } from '@/lib/strapi';
import { resolveMetadata, itemListJsonLd } from '@/lib/seo';
import { ArticleCard } from './ArticleCard';
import { Breadcrumb } from './Breadcrumb';
import { JsonLd } from './JsonLd';
import { Pagination, pageHref, MAX_LIST_PAGES } from './Pagination';
import { HotList } from './HotList';
import { AdSlotBanner } from './AdSlotBanner';
import { TagCloud } from './TagCloud';
import { SITE_URL } from '@/lib/env';

export const AUTHOR_PAGE_SIZE = 20;

export async function authorMeta(slug: string, page: number): Promise<Metadata> {
  const [author, global] = await Promise.all([getAuthorBySlug(slug), getGlobal()]);
  if (!author) return {};
  const base = `/author/${slug}`;
  const title =
    page > 1 ? `${author.name} - 第 ${page} 页` : `${author.name}${author.role ? ` · ${author.role}` : ''}`;
  return resolveMetadata({
    seo: author.seo,
    global,
    fallbackTitle: title,
    fallbackDescription: author.bio,
    path: base,
    canonicalPath: pageHref(base, page),
  });
}

export async function AuthorView({ slug, page }: { slug: string; page: number }) {
  if (page > MAX_LIST_PAGES) notFound(); // 翻页限深：与频道/标签一致（更早走归档/sitemap）
  const [author, { items, pageCount, total }] = await Promise.all([
    getAuthorBySlug(slug),
    getArticlesByAuthor(slug, page, AUTHOR_PAGE_SIZE),
  ]);
  if (!author) notFound();
  // 作者无文章（如文章全删）→ 404，避免薄内容/软 404
  if (total === 0) notFound();
  if (page > 1 && items.length === 0) notFound();

  const base = `/author/${slug}`;
  const avatar = mediaUrl(author.avatar);

  const personLd = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: author.name,
    url: `${SITE_URL}${base}`,
    description: author.bio ?? undefined,
    image: avatar ?? undefined,
    jobTitle: author.role ?? undefined,
  };

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start lg:gap-5">
      <div className="min-w-0">
        <Breadcrumb
          items={[
            { name: '首页', path: '/' },
            { name: author.name, path: base },
          ]}
        />
        <JsonLd data={personLd} />
        <JsonLd
          data={itemListJsonLd(
            items.map((a) => ({ name: a.title, path: `/${a.channel?.slug ?? 'news'}/${a.slug}` })),
            `${author.name} 的文章`,
          )}
        />

        {/* 作者头部（E-E-A-T） */}
        <header className="mb-3 flex items-center gap-4 rounded-lg bg-white p-4">
          {avatar ? (
            <Image
              src={avatar}
              alt={imageAlt(author.avatar, `${author.name}${author.role ? `，${author.role}` : ''}的头像`)}
              width={64}
              height={64}
              className="h-16 w-16 rounded-full object-cover"
            />
          ) : (
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand text-2xl font-medium text-white">
              {author.name.slice(0, 1)}
            </span>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-gray-900">{author.name}</h1>
              {author.role ? (
                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
                  {author.role}
                </span>
              ) : null}
            </div>
            {author.bio ? (
              <p className="mt-1 text-sm leading-6 text-gray-500">{author.bio}</p>
            ) : null}
          </div>
        </header>

        {items.length === 0 ? (
          <p className="rounded-lg bg-white p-6 text-center text-sm text-gray-500">
            该作者暂无文章。
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

      {/* 侧边功能推荐：热门排行 / 推广位 / 标签云（与频道/标签页一致） */}
      <aside className="lg:sticky lg:top-16">
        <HotList title="热门排行" />
        <AdSlotBanner slotKey="author-aside" />
        <TagCloud />
      </aside>
    </div>
  );
}
