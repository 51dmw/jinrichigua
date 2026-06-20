import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getAdjacentArticles,
  getAllArticlesForSitemap,
  getArticleBySlug,
  getGlobal,
  getRelatedArticles,
  mediaUrl,
  imageAlt,
} from '@/lib/strapi';
import { newsArticleJsonLd, resolveMetadata } from '@/lib/seo';
import { JsonLd } from '@/components/JsonLd';
import { Breadcrumb } from '@/components/Breadcrumb';
import { ArticleCard } from '@/components/ArticleCard';
import { AdSlotBanner } from '@/components/AdSlotBanner';
import { HotList } from '@/components/HotList';
import { ChannelLatest } from '@/components/ChannelLatest';
import { TagChip } from '@/components/TagChip';
import { PrevNextNav } from '@/components/PrevNextNav';
import { ShareButtons } from '@/components/ShareButtons';
import { AuthorCard } from '@/components/AuthorCard';
import { SITE_URL, TURNSTILE_SITE_KEY } from '@/lib/env';
import { ViewTracker } from '@/components/ViewTracker';
import { ArticleComments } from '@/components/ArticleComments';
import { AdAnchor } from '@/components/AdAnchor';
import { CoverPlaceholder } from '@/components/CoverPlaceholder';

export const revalidate = 120; // ISR（§5：保证新闻时效）
export const dynamicParams = true;

export async function generateStaticParams() {
  const articles = await getAllArticlesForSitemap();
  return articles.map((a) => ({ channelSlug: a.channelSlug, articleSlug: a.slug }));
}

type Params = Promise<{ channelSlug: string; articleSlug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { channelSlug, articleSlug } = await params;
  const [article, global] = await Promise.all([
    getArticleBySlug(channelSlug, articleSlug),
    getGlobal(),
  ]);
  if (!article) return {};

  // 回退链：单页 seo > Global 默认 > 内容字段(title/summary/cover)（§3）
  const tagNames = (article.tags ?? []).map((t) => t.name);
  return resolveMetadata({
    seo: article.seo,
    global,
    fallbackTitle: article.title,
    fallbackDescription: article.summary,
    fallbackImage: mediaUrl(article.cover),
    path: `/${channelSlug}/${articleSlug}`,
    fallbackKeywords: tagNames.length ? tagNames.join(',') : undefined,
    // 新闻 SEO：og:type=article + article:* 字段
    ogType: 'article',
    articleOg: {
      publishedTime: article.publishAt ?? article.publishedAt,
      modifiedTime: article.updatedAt,
      authors: article.author ? [article.author] : undefined,
      section: article.channel?.name,
      tags: tagNames,
    },
  });
}

function formatDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default async function ArticlePage({ params }: { params: Params }) {
  const { channelSlug, articleSlug } = await params;
  const [article, global] = await Promise.all([
    getArticleBySlug(channelSlug, articleSlug),
    getGlobal(),
  ]);
  if (!article) notFound();

  const path = `/${channelSlug}/${articleSlug}`;
  const cover = mediaUrl(article.cover);
  const published = article.publishAt ?? article.publishedAt;
  const newsLd = newsArticleJsonLd(article, global, path);
  // 相关推荐按当前文章标签算；与相邻文章并行取
  const tagSlugs = (article.tags ?? []).map((t) => t.slug);
  const [adjacent, related] = await Promise.all([
    getAdjacentArticles(channelSlug, published, articleSlug),
    getRelatedArticles(channelSlug, articleSlug, tagSlugs, 6),
  ]);

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start lg:gap-5">
      <div className="min-w-0">
      <article className="rounded-lg bg-white p-4">
      <JsonLd data={newsLd} />

      <Breadcrumb
        items={[
          { name: '首页', path: '/' },
          { name: article.channel?.name ?? channelSlug, path: `/${channelSlug}` },
          { name: article.title, path },
        ]}
      />

      <h1 className="text-xl font-bold leading-snug text-gray-900">{article.title}</h1>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 text-xs text-gray-500">
        {published ? <time dateTime={published}>{formatDate(published)}</time> : null}
        {article.source ? <span>来源：{article.source}</span> : null}
        {article.authorRef ? (
          <Link href={`/author/${article.authorRef.slug}`} className="text-gray-500 hover:text-brand">
            作者：{article.authorRef.name}
          </Link>
        ) : article.author ? (
          <span>作者：{article.author}</span>
        ) : null}
      </div>

      {cover ? (
        <div className="relative mt-3 aspect-[16/9] w-full overflow-hidden rounded">
          <Image
            src={cover}
            alt={imageAlt(article.cover, article.title)}
            fill
            sizes="(max-width: 640px) 100vw, 640px"
            priority
            className="object-cover"
          />
        </div>
      ) : (
        <div className="relative mt-3 aspect-[16/9] w-full overflow-hidden rounded">
          <CoverPlaceholder />
        </div>
      )}

      {/* 正文：服务端完整输出（§4 MUST：不得依赖客户端 JS） */}
      <div className="article-body mt-4">
        {(() => {
          const paras = (article.content ?? article.summary ?? '')
            .split('\n')
            .filter((line) => line.trim().length > 0)
            .map((line) => line.replace(/^#+\s*/, ''));
          // 正文内原生位：约第 3 段后插入（正文 ≥5 段才插，避免短文打断阅读）
          const adAfter = paras.length >= 5 ? 2 : -1;
          return paras.map((line, i) => [
            <p key={`p-${i}`}>{line}</p>,
            i === adAfter ? <AdSlotBanner key="article-inline" slotKey="article-inline" /> : null,
          ]);
        })()}
      </div>

      {article.tags && article.tags.length > 0 ? (
        <div className="mt-5 flex flex-wrap gap-2">
          {article.tags.map((t) => (
            <TagChip key={t.documentId} slug={t.slug} name={t.name} />
          ))}
        </div>
      ) : null}

      {/* 作者署名卡（E-E-A-T） */}
      {article.authorRef ? <AuthorCard author={article.authorRef} /> : null}

      {/* 社交分享 */}
      <ShareButtons url={`${SITE_URL}${path}`} title={article.title} />

      {/* 免责声明（后台 Global.disclaimer 可编辑） */}
      <p className="mt-4 rounded bg-gray-50 p-3 text-xs leading-5 text-gray-500">
        {global?.disclaimer ??
          '免责声明：本站内容多来源于网络公开渠道及用户投稿，仅代表作者个人观点，不代表本站立场；相关信息仅供娱乐与参考，不构成任何投资、决策或法律建议。如涉及侵权、不实或个人隐私，请通过「联络我们」与我们联系处理。'}
      </p>
      </article>

      {/* PV 统计（§M6） */}
      <ViewTracker documentId={article.documentId} />

      {/* 上一篇 / 下一篇 */}
      <PrevNextNav prev={adjacent.prev} next={adjacent.next} />

      {/* 文章页底部广告位（§M6） */}
      <div className="mt-4">
        <AdSlotBanner slotKey="article-bottom" />
      </div>

      {/* 评论（独立客户端渲染，不进文章服务端 HTML） */}
      <ArticleComments articleId={article.documentId} turnstileSiteKey={TURNSTILE_SITE_KEY} />

      {/* 相关推荐（§ M3） */}
      {related.length > 0 ? (
        <aside className="mt-4 rounded-lg bg-white p-4">
          <h2 className="mb-2 border-l-4 border-brand pl-2 text-base font-bold text-gray-900">
            相关推荐
          </h2>
          <div className="divide-y divide-gray-100">
            {related.map((a) => (
              <ArticleCard key={a.documentId} article={a} variant="left-text-right-image" />
            ))}
          </div>
        </aside>
      ) : null}
      </div>

      {/* 右侧栏（PC）/ 移动端落底部 */}
      <aside className="lg:sticky lg:top-16">
        <HotList channelSlug={channelSlug} title="频道热门" />
        <AdSlotBanner slotKey="article-aside" />
        <ChannelLatest channelSlug={channelSlug} title="频道最新" limit={8} excludeSlug={articleSlug} />
        <AdSlotBanner slotKey="article-aside-2" />
      </aside>
      <AdAnchor slotKey="article-anchor" />
    </div>
  );
}
