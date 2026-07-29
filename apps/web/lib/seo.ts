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

// 返回具体对象类型而非 Metadata['robots'] 联合类型——调用方需要读 .index
// 来决定要不要输出 hreflang（见 resolveMetadata），联合类型里的 string 分支会挡住。
function robotsFrom(
  seo?: SeoMetaData | null,
  global?: GlobalSettings | null,
): { index: boolean; follow: boolean } {
  const r = seo?.robots ?? global?.defaultRobots ?? { index: true, follow: true };
  return { index: r.index, follow: r.follow };
}

/**
 * 站点级实体的稳定 @id（SEO 审计 #45/#47）。
 *
 * 用 `/#name` 形式是 schema.org 实体图的通行写法（Yoast/RankMath 同款）：@id 只是
 * 全局唯一标识符，不要求与 canonical 逐字符相同，所以这里带斜杠不影响「全站无尾斜杠」策略。
 * 一旦发布就不能再改——改了等于换了一个实体，搜索引擎侧已积累的实体关联会断开。
 */
export const ENTITY_ID = {
  organization: `${SITE_URL}/#organization`,
  logo: `${SITE_URL}/#logo`,
  website: `${SITE_URL}/#website`,
} as const;

/** 页面级实体 @id：同一页的各实体靠它互相引用。 */
function pageEntityId(url: string, name: 'webpage' | 'breadcrumb' | 'article' | 'itemlist'): string {
  return `${url}#${name}`;
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
  /**
   * robots 覆盖。搜索页这类「代码里硬性 noindex」的页面必须从这里传，
   * 不能在拿到返回值后再 `{...meta, robots}` 覆盖——那样 resolveMetadata 里
   * 按 index=true 算出的 hreflang 会留在结果里，正是 SEO 审计 #57 的成因。
   */
  robots?: { index: boolean; follow: boolean };
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
  robots: robotsOverride,
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

  const robots = robotsOverride ?? robotsFrom(seo, global);
  // noindex 页不输出 hreflang（SEO 审计 #57）：alternate 对不进索引的页面是无效信号，
  // 且带参变体（/search?q=x）不会回指自己，会被 hreflang 校验器判成 MissingSelfHreflang。
  // canonical 保留——它仍需要把参数变体合并到无参版本。
  const alternates: Metadata['alternates'] = { canonical };
  if (robots.index !== false) {
    // §4：当前单语言，结构先留好，未来多语言直接扩 languages
    alternates.languages = {
      [SITE_LOCALE]: canonical,
      'x-default': canonical,
    };
  }

  return {
    title,
    description,
    keywords,
    alternates,
    robots,
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
    '@id': pageEntityId(url, 'article'),
    headline: article.title,
    description: article.summary ?? undefined,
    image: image ? [image] : undefined,
    datePublished: published,
    dateModified: article.updatedAt,
    // 栏目归属（SEO 审计 #10 剩余项）：让 Google 知道这篇属于哪个频道
    articleSection: article.channel?.name ?? undefined,
    author: article.authorRef
      ? {
          '@type': 'Person',
          name: article.authorRef.name,
          url: abs(`/author/${article.authorRef.slug}`),
          description: article.authorRef.bio ?? undefined,
        }
      : article.author
        ? { '@type': 'Person', name: article.author }
        : { '@id': ENTITY_ID.organization },
    // publisher 引用 layout 里的站点实体，不再重复展开一份（#45 实体图闭环）
    publisher: { '@id': ENTITY_ID.organization },
    // 挂到 Breadcrumb 组件输出的 WebPage 上（详情页必渲染 Breadcrumb，见 app/[channelSlug]/[articleSlug]/page.tsx）
    isPartOf: { '@id': pageEntityId(url, 'webpage') },
    mainEntityOfPage: { '@id': pageEntityId(url, 'webpage') },
    // AI Overviews / 语音助手挑朗读片段的信号（#43）。选择器必须对应真实 DOM：
    // h1 是文章标题，.article-body 见 app/globals.css。
    speakable: {
      '@type': 'SpeakableSpecification',
      cssSelector: ['h1', '.article-body p'],
    },
  };
}

/**
 * 页面级实体图：WebPage + BreadcrumbList，合并成一段脚本（SEO 审计 #47/#48）。
 *
 * 由 Breadcrumb 组件调用——面包屑最后一项就是当前页，所以它天然知道本页 URL，
 * 不需要每个页面再传一遍。全站 9 处页面都渲染 Breadcrumb（首页除外，首页由
 * layout 的 WebSite 实体承载），因此 WebPage 覆盖到除首页外的所有页型。
 */
export function pageGraphJsonLd(
  items: Array<{ name: string; path: string }>,
): Record<string, unknown> {
  const current = items[items.length - 1];
  const url = abs(current.path);

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': pageEntityId(url, 'webpage'),
        url,
        name: current.name,
        inLanguage: SITE_LOCALE,
        isPartOf: { '@id': ENTITY_ID.website },
        breadcrumb: { '@id': pageEntityId(url, 'breadcrumb') },
      },
      {
        '@type': 'BreadcrumbList',
        '@id': pageEntityId(url, 'breadcrumb'),
        itemListElement: items.map((it, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: it.name,
          item: abs(it.path),
        })),
      },
    ],
  };
}

// ─────────────────────────────────────────────────────────────
// 站点级实体（§4：Organization + WebSite，注入根 layout 一次）
// ─────────────────────────────────────────────────────────────

/**
 * 站点级实体图：Organization + Logo + WebSite 合并成一段脚本（SEO 审计 #45/#48）。
 *
 * 改造前是两段独立 JSON-LD、各带一份 @context、彼此无引用关系，搜索引擎和 AI 抽取器
 * 只能看到三个孤立实体。现在用 @id 串成一张图：WebSite.publisher → Organization，
 * 页面级的 WebPage.isPartOf → WebSite，Article.publisher → Organization。
 *
 * 注：sameAs（官方社交账号）暂缺——没有真实账号就不能填，指向不存在的页面会反向
 * 伤害实体识别。等有了账号在 Organization 上补 sameAs 即可，不影响这里的图结构。
 */
export function siteGraphJsonLd(global: GlobalSettings | null): Record<string, unknown> {
  const siteName = global?.siteName ?? 'News Portal';
  const logo = globalOgImage(global)[0];
  const graph: Record<string, unknown>[] = [];

  graph.push({
    '@type': 'NewsMediaOrganization',
    '@id': ENTITY_ID.organization,
    name: siteName,
    url: SITE_URL,
    ...(logo ? { logo: { '@id': ENTITY_ID.logo }, image: { '@id': ENTITY_ID.logo } } : {}),
  });

  if (logo) {
    graph.push({
      '@type': 'ImageObject',
      '@id': ENTITY_ID.logo,
      url: logo,
      contentUrl: logo,
    });
  }

  graph.push({
    '@type': 'WebSite',
    '@id': ENTITY_ID.website,
    name: siteName,
    url: SITE_URL,
    inLanguage: SITE_LOCALE,
    publisher: { '@id': ENTITY_ID.organization },
    // 站内搜索（Google sitelinks 搜索框）。对应的表单见 components/SearchBox.tsx，
    // 那里必须是真能 GET 提交到 /search?q= 的原生表单，否则这段是空头支票。
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${SITE_URL}/search?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  });

  return { '@context': 'https://schema.org', '@graph': graph };
}

/** 列表页结构化数据（频道/热榜/标签）：ItemList。 */
export function itemListJsonLd(
  items: Array<{ name: string; path: string }>,
  name: string,
  /** 所属页面路径；给出后 ItemList 会挂到该页的 WebPage 实体上（#47） */
  path?: string,
): Record<string, unknown> {
  const pageUrl = path ? abs(path) : null;
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    ...(pageUrl
      ? {
          '@id': pageEntityId(pageUrl, 'itemlist'),
          mainEntityOfPage: { '@id': pageEntityId(pageUrl, 'webpage') },
        }
      : {}),
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
