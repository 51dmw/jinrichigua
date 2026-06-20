/**
 * SEO 元数据回退链 + JSON-LD（§3 / §4）。
 *
 * 回退链（MUST）：单页 seo 字段 > Global 默认值 > 内容字段兜底(title/summary/cover)
 */
import type { Metadata } from 'next';
import type { Article, GlobalSettings, SeoMetaData } from 'shared';
import { SITE_URL, SITE_LOCALE } from './env';
import { mediaUrl } from './strapi';

function abs(path: string): string {
  if (path.startsWith('http')) return path;
  // 全站统一「无尾斜杠」规范（与 middleware 规范化 + trailingSlash:false 一致）。
  // 根路径返回站点根（无尾斜杠）；Next 也会对 canonical 强制去尾斜杠，保持一致。
  if (path === '/' || path === '') return SITE_URL;
  return `${SITE_URL}${path.startsWith('/') ? '' : '/'}${path}`;
}

function robotsFrom(seo?: SeoMetaData | null, global?: GlobalSettings | null): Metadata['robots'] {
  const r = seo?.robots ?? global?.defaultRobots ?? { index: true, follow: true };
  return { index: r.index, follow: r.follow };
}

/** 站点级默认（用于根 layout 的 metadata，含 titleTemplate / 站长验证）。 */
export function buildSiteMetadata(global: GlobalSettings | null): Metadata {
  const siteName = global?.siteName ?? 'News Portal';
  const template = global?.titleTemplate ?? `%s | ${siteName}`;
  const verification: Metadata['verification'] = {};
  if (global?.googleSiteVerification) verification.google = global.googleSiteVerification;
  if (global?.yandexSiteVerification) verification.yandex = global.yandexSiteVerification;
  if (global?.bingSiteVerification) {
    verification.other = { 'msvalidate.01': global.bingSiteVerification };
  }

  return {
    metadataBase: new URL(SITE_URL),
    title: { default: siteName, template },
    description: global?.defaultSeo?.metaDescription ?? undefined,
    applicationName: siteName,
    // 不在根 layout 设全局 robots：默认即 index,follow，无需显式输出；
    // 各页自行通过 resolveMetadata 设 robots，not-found 页单独设 noindex，避免重复 meta。
    verification,
    openGraph: {
      type: 'website',
      locale: SITE_LOCALE.replace('-', '_'), // og:locale = zh_CN
      siteName,
      images: globalOgImage(global).map((url) => ({ url, alt: siteName })),
    },
  };
}

function globalOgImage(global: GlobalSettings | null): string[] {
  const url = mediaUrl(global?.defaultOgImage) ?? mediaUrl(global?.defaultSeo?.ogImage);
  return url ? [url] : [];
}

/** 文章专属 OG 字段（§4 新闻 SEO）。 */
export interface ArticleOg {
  publishedTime?: string | null;
  modifiedTime?: string | null;
  authors?: string[];
  section?: string | null;
  tags?: string[];
}

interface ResolveArgs {
  seo?: SeoMetaData | null;
  global: GlobalSettings | null;
  fallbackTitle: string;
  fallbackDescription?: string | null;
  fallbackImage?: string | null;
  /** 站内绝对路径，如 /tech/foo */
  path: string;
  /** 关键词兜底（如文章取自标签） */
  fallbackKeywords?: string | string[] | null;
  /** og:type；文章页传 'article' 并配 articleOg */
  ogType?: 'website' | 'article';
  articleOg?: ArticleOg;
  /** canonical 覆盖（如分页 ?page=N 自指） */
  canonicalPath?: string;
}

/** 通用回退链解析 → Next Metadata。 */
export function resolveMetadata({
  seo,
  global,
  fallbackTitle,
  fallbackDescription,
  fallbackImage,
  path,
  fallbackKeywords,
  ogType = 'website',
  articleOg,
  canonicalPath,
}: ResolveArgs): Metadata {
  const title = seo?.metaTitle ?? fallbackTitle;
  const description =
    seo?.metaDescription ?? fallbackDescription ?? global?.defaultSeo?.metaDescription ?? undefined;
  const canonical = seo?.canonicalURL ? abs(seo.canonicalURL) : abs(canonicalPath ?? path);
  const ogImg =
    mediaUrl(seo?.ogImage) ?? fallbackImage ?? globalOgImage(global)[0] ?? undefined;
  const keywords = seo?.keywords ?? fallbackKeywords ?? undefined;
  // OG 图带 alt（SEO/社交分享可访问性）：取 og 标题，回退页面标题
  const ogImageAlt = seo?.ogTitle ?? title;
  const images = (ogImg ? [ogImg] : globalOgImage(global)).map((url) => ({
    url,
    alt: ogImageAlt,
  }));

  const ogLocale = SITE_LOCALE.replace('-', '_'); // og:locale = zh_CN
  const openGraph: Metadata['openGraph'] =
    ogType === 'article'
      ? {
          type: 'article',
          locale: ogLocale,
          title: seo?.ogTitle ?? title,
          description: seo?.ogDescription ?? description,
          url: canonical,
          siteName: global?.siteName ?? 'News Portal',
          images,
          publishedTime: articleOg?.publishedTime ?? undefined,
          modifiedTime: articleOg?.modifiedTime ?? undefined,
          authors: articleOg?.authors,
          section: articleOg?.section ?? undefined,
          tags: articleOg?.tags,
        }
      : {
          type: 'website',
          locale: ogLocale,
          title: seo?.ogTitle ?? title,
          description: seo?.ogDescription ?? description,
          url: canonical,
          siteName: global?.siteName ?? 'News Portal',
          images,
        };

  return {
    title,
    description,
    keywords,
    // canonical + hreflang（§4：当前单语言，结构先留好，未来多语言直接扩 languages）
    alternates: {
      canonical,
      languages: {
        [SITE_LOCALE]: canonical,
        'x-default': canonical,
      },
    },
    robots: robotsFrom(seo, global),
    openGraph,
    twitter: {
      card: seo?.twitterCard ?? 'summary_large_image',
      title: seo?.ogTitle ?? title,
      description: seo?.ogDescription ?? description,
      images: ogImg ? [{ url: ogImg, alt: ogImageAlt }] : undefined,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// JSON-LD（§4 MUST：文章页 NewsArticle + BreadcrumbList）
// ─────────────────────────────────────────────────────────────

export function newsArticleJsonLd(
  article: Article,
  global: GlobalSettings | null,
  path: string,
): Record<string, unknown> | null {
  const type = article.seo?.structuredDataType ?? 'NewsArticle';
  if (type === 'none') return null;
  // 允许后台手动覆盖
  if (article.seo?.structuredDataJSON && Object.keys(article.seo.structuredDataJSON).length > 0) {
    return article.seo.structuredDataJSON;
  }

  const url = abs(path);
  const image = mediaUrl(article.cover) ?? globalOgImage(global)[0];
  const published = article.publishAt ?? article.publishedAt ?? article.createdAt;

  return {
    '@context': 'https://schema.org',
    '@type': type,
    headline: article.title,
    description: article.summary ?? undefined,
    image: image ? [image] : undefined,
    datePublished: published,
    dateModified: article.updatedAt,
    author: article.authorRef
      ? {
          '@type': 'Person',
          name: article.authorRef.name,
          url: abs(`/author/${article.authorRef.slug}`),
          description: article.authorRef.bio ?? undefined,
        }
      : article.author
        ? { '@type': 'Person', name: article.author }
        : { '@type': 'Organization', name: global?.siteName ?? 'News Portal' },
    publisher: {
      '@type': 'Organization',
      name: global?.siteName ?? 'News Portal',
      logo: globalOgImage(global)[0]
        ? { '@type': 'ImageObject', url: globalOgImage(global)[0] }
        : undefined,
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
  };
}

export function breadcrumbJsonLd(
  items: Array<{ name: string; path: string }>,
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: abs(it.path),
    })),
  };
}

// ─────────────────────────────────────────────────────────────
// 站点级实体（§4：Organization + WebSite，注入根 layout 一次）
// ─────────────────────────────────────────────────────────────

export function organizationJsonLd(global: GlobalSettings | null): Record<string, unknown> {
  const logo = globalOgImage(global)[0];
  return {
    '@context': 'https://schema.org',
    '@type': 'NewsMediaOrganization',
    name: global?.siteName ?? 'News Portal',
    url: SITE_URL,
    logo: logo ? { '@type': 'ImageObject', url: logo } : undefined,
  };
}

export function websiteJsonLd(global: GlobalSettings | null): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: global?.siteName ?? 'News Portal',
    url: SITE_URL,
    inLanguage: SITE_LOCALE,
    // 站内搜索（Google sitelinks 搜索框）
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${SITE_URL}/search?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

/** 列表页结构化数据（频道/热榜/标签）：ItemList。 */
export function itemListJsonLd(
  items: Array<{ name: string; path: string }>,
  name: string,
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name,
    numberOfItems: items.length,
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      url: abs(it.path),
    })),
  };
}
