/**
 * Strapi 5 REST 取数层（前台只读「已发布」内容，§2）。
 *
 * Strapi 5 的 REST 响应已扁平化（不再有 v4 的 `attributes` 包裹），
 * 故这里直接把 `data` 当领域对象用，仅做媒体 URL 绝对化处理。
 */
import type {
  AdSlot,
  Article,
  ArticleListItem,
  Author,
  Channel,
  GlobalSettings,
  Tag,
  HomeBlock,
  HomePageLayout,
  BlockVariant,
  MediaImage,
  Page,
  StrapiListResponse,
  StrapiSingleResponse,
} from 'shared';
import { STRAPI_API_URL, STRAPI_API_TOKEN, REVALIDATE_SECONDS } from './env';

const TAGS = {
  global: 'global',
  channels: 'channels',
  articles: 'articles',
  home: 'home',
  adslots: 'adslots',
} as const;

async function strapiGet<T>(
  path: string,
  opts: { tags?: string[]; revalidate?: number } = {},
): Promise<T> {
  const res = await fetch(`${STRAPI_API_URL}/api${path}`, {
    headers: STRAPI_API_TOKEN ? { Authorization: `Bearer ${STRAPI_API_TOKEN}` } : {},
    next: {
      revalidate: opts.revalidate ?? REVALIDATE_SECONDS,
      tags: opts.tags,
    },
  });
  if (!res.ok) {
    throw new Error(`Strapi ${res.status} ${res.statusText} :: GET /api${path}`);
  }
  return (await res.json()) as T;
}

/** 媒体 URL 绝对化：Strapi 本地存储返回相对路径，R2/CDN 返回绝对路径。 */
export function mediaUrl(m?: MediaImage | null): string | null {
  if (!m?.url) return null;
  return m.url.startsWith('http') ? m.url : `${STRAPI_API_URL}${m.url}`;
}

/**
 * 图片 alt 默认取值（SEO/可访问性）——全站统一出口。
 * 优先用 CMS 填写的 alternativeText；为空则回退到传入的描述性兜底
 * （文章标题 / 作者名等，绝不输出空 alt，避免无障碍与 SEO 失分）。
 */
export function imageAlt(m: MediaImage | null | undefined, fallback: string): string {
  const alt = m?.alternativeText?.trim();
  return alt && alt.length > 0 ? alt : fallback.trim();
}

const SEO_POPULATE = 'populate[seo][populate][ogImage]=true&populate[seo][populate][robots]=true';

// ─────────────────────────────────────────────────────────────
// Global
// ─────────────────────────────────────────────────────────────

export async function getGlobal(): Promise<GlobalSettings | null> {
  try {
    const json = await strapiGet<StrapiSingleResponse<GlobalSettings>>(
      `/global?populate[defaultOgImage]=true&populate[defaultRobots]=true&${SEO_POPULATE.replace(/seo/g, 'defaultSeo')}`,
      { tags: [TAGS.global] },
    );
    return json.data ?? null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// Channels
// ─────────────────────────────────────────────────────────────

export async function getNavChannels(): Promise<Channel[]> {
  try {
    const json = await strapiGet<StrapiListResponse<Channel>>(
      `/channels?filters[isNav][$eq]=true&filters[parent][$null]=true&sort=order:asc&populate[children]=true&pagination[pageSize]=50`,
      { tags: [TAGS.channels] },
    );
    return json.data ?? [];
  } catch {
    return [];
  }
}

export async function getChannelBySlug(slug: string): Promise<Channel | null> {
  const json = await strapiGet<StrapiListResponse<Channel>>(
    `/channels?filters[slug][$eq]=${encodeURIComponent(slug)}&populate[children]=true&${SEO_POPULATE}`,
    { tags: [TAGS.channels, `channel:${slug}`] },
  );
  return json.data?.[0] ?? null;
}

/** 有文章的频道 slug（供 sitemap / 预渲染——空频道不入站点地图、noindex 处理见 channelMeta）。 */
export async function getAllChannelSlugs(): Promise<string[]> {
  try {
    const json = await strapiGet<StrapiListResponse<Pick<Channel, 'slug'>>>(
      `/channels?fields[0]=slug&filters[articles][documentId][$notNull]=true&pagination[pageSize]=200`,
      { tags: [TAGS.channels] },
    );
    return (json.data ?? []).map((c) => c.slug);
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────
// Articles
// ─────────────────────────────────────────────────────────────

const LIST_POPULATE = 'populate[cover]=true&populate[channel]=true';

export async function getArticlesByChannel(
  channelSlug: string,
  page = 1,
  pageSize = 20,
): Promise<{ items: ArticleListItem[]; pageCount: number; total: number }> {
  const json = await strapiGet<StrapiListResponse<ArticleListItem>>(
    `/articles?filters[channel][slug][$eq]=${encodeURIComponent(channelSlug)}` +
      `&sort[0]=publishAt:desc&sort[1]=publishedAt:desc&${LIST_POPULATE}` +
      `&pagination[page]=${page}&pagination[pageSize]=${pageSize}`,
    { tags: [TAGS.articles, `channel:${channelSlug}`] },
  );
  return {
    items: json.data ?? [],
    pageCount: json.meta.pagination?.pageCount ?? 1,
    total: json.meta.pagination?.total ?? 0,
  };
}

export async function getLatestArticles(limit = 6): Promise<ArticleListItem[]> {
  try {
    const json = await strapiGet<StrapiListResponse<ArticleListItem>>(
      `/articles?sort[0]=publishAt:desc&sort[1]=publishedAt:desc&${LIST_POPULATE}&pagination[pageSize]=${limit}`,
      { tags: [TAGS.articles] },
    );
    return json.data ?? [];
  } catch {
    return [];
  }
}

export async function getArticlesByTag(
  tagSlug: string,
  page = 1,
  pageSize = 20,
): Promise<{ tagName: string | null; items: ArticleListItem[]; pageCount: number; total: number }> {
  const json = await strapiGet<StrapiListResponse<ArticleListItem>>(
    `/articles?filters[tags][slug][$eq]=${encodeURIComponent(tagSlug)}` +
      `&sort[0]=publishAt:desc&sort[1]=publishedAt:desc&${LIST_POPULATE}&populate[tags]=true` +
      `&pagination[page]=${page}&pagination[pageSize]=${pageSize}`,
    { tags: [TAGS.articles, `tag:${tagSlug}`] },
  );
  const items = json.data ?? [];
  const tagName = items[0]?.tags?.find((t) => t.slug === tagSlug)?.name ?? null;
  return {
    tagName,
    items,
    pageCount: json.meta.pagination?.pageCount ?? 1,
    total: json.meta.pagination?.total ?? items.length,
  };
}

/** 站内搜索：标题/摘要/正文 模糊匹配（结果页 noindex）。 */
export async function searchArticles(
  q: string,
  page = 1,
  pageSize = 20,
): Promise<{ items: ArticleListItem[]; total: number; pageCount: number }> {
  const term = q.trim();
  if (!term) return { items: [], total: 0, pageCount: 0 };
  const e = encodeURIComponent(term);
  try {
    const json = await strapiGet<StrapiListResponse<ArticleListItem>>(
      `/articles?filters[$or][0][title][$containsi]=${e}` +
        `&filters[$or][1][summary][$containsi]=${e}` +
        `&filters[$or][2][content][$containsi]=${e}` +
        `&sort[0]=publishAt:desc&sort[1]=publishedAt:desc&${LIST_POPULATE}` +
        `&pagination[page]=${page}&pagination[pageSize]=${pageSize}`,
      { revalidate: 0 },
    );
    const p = json.meta?.pagination;
    return { items: json.data ?? [], total: p?.total ?? 0, pageCount: p?.pageCount ?? 0 };
  } catch {
    return { items: [], total: 0, pageCount: 0 };
  }
}

// ── 文章归档（按年/月，§SEO 内链枢纽）──
export interface ArchiveMonth {
  month: number;
  count: number;
}
export interface ArchiveYear {
  year: number;
  total: number;
  months: ArchiveMonth[];
}

/** 全站已发布文章按「年→月」聚合（取发布时间，分页拉日期后在内存分组）。 */
export async function getArchiveIndex(): Promise<ArchiveYear[]> {
  try {
    const map = new Map<number, Map<number, number>>();
    let page = 1;
    for (; page <= 50; page += 1) {
      const json = await strapiGet<StrapiListResponse<{ publishAt?: string | null; publishedAt?: string | null }>>(
        `/articles?fields[0]=publishAt&fields[1]=publishedAt&sort=publishAt:desc` +
          `&pagination[page]=${page}&pagination[pageSize]=100`,
        { tags: [TAGS.articles] },
      );
      const data = json.data ?? [];
      for (const a of data) {
        const d = a.publishAt ?? a.publishedAt;
        if (!d) continue;
        const dt = new Date(d);
        if (Number.isNaN(dt.getTime())) continue;
        const y = dt.getFullYear();
        const m = dt.getMonth() + 1;
        if (!map.has(y)) map.set(y, new Map());
        const mm = map.get(y)!;
        mm.set(m, (mm.get(m) ?? 0) + 1);
      }
      const pc = json.meta?.pagination?.pageCount ?? 1;
      if (page >= pc || data.length === 0) break;
    }
    return [...map.entries()]
      .map(([year, mm]) => ({
        year,
        total: [...mm.values()].reduce((s, c) => s + c, 0),
        months: [...mm.entries()]
          .map(([month, count]) => ({ month, count }))
          .sort((a, b) => b.month - a.month),
      }))
      .sort((a, b) => b.year - a.year);
  } catch {
    return [];
  }
}

/** 某年某月的已发布文章（分页，复用列表版式）。 */
export async function getArticlesByMonth(
  year: number,
  month: number,
  page = 1,
  pageSize = 20,
): Promise<{ items: ArticleListItem[]; total: number; pageCount: number }> {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const ny = month === 12 ? year + 1 : year;
  const nm = month === 12 ? 1 : month + 1;
  const end = `${ny}-${String(nm).padStart(2, '0')}-01`;
  try {
    const json = await strapiGet<StrapiListResponse<ArticleListItem>>(
      `/articles?filters[publishAt][$gte]=${start}&filters[publishAt][$lt]=${end}` +
        `&sort[0]=publishAt:desc&${LIST_POPULATE}&pagination[page]=${page}&pagination[pageSize]=${pageSize}`,
      { tags: [TAGS.articles] },
    );
    const p = json.meta?.pagination;
    return { items: json.data ?? [], total: p?.total ?? 0, pageCount: p?.pageCount ?? 0 };
  } catch {
    return { items: [], total: 0, pageCount: 0 };
  }
}

/** 有文章的标签 slug（供 sitemap 用——空标签不入站点地图，避免 404 链接 + 薄内容）。 */
export async function getAllTagSlugs(): Promise<string[]> {
  try {
    const json = await strapiGet<StrapiListResponse<{ slug: string }>>(
      `/tags?fields[0]=slug&filters[articles][documentId][$notNull]=true&pagination[pageSize]=200`,
      { tags: ['tags'] },
    );
    return (json.data ?? []).map((t) => t.slug);
  } catch {
    return [];
  }
}

export async function getArticleBySlug(
  channelSlug: string,
  articleSlug: string,
): Promise<Article | null> {
  const json = await strapiGet<StrapiListResponse<Article>>(
    `/articles?filters[slug][$eq]=${encodeURIComponent(articleSlug)}` +
      `&filters[channel][slug][$eq]=${encodeURIComponent(channelSlug)}` +
      `&populate[cover]=true&populate[channel]=true&populate[tags]=true` +
      `&populate[authorRef][populate][avatar]=true&${SEO_POPULATE}`,
    { tags: [TAGS.articles, `article:${channelSlug}/${articleSlug}`] },
  );
  return json.data?.[0] ?? null;
}

/** 取作者实体（含头像/简介/seo），供作者页/文章页用。 */
export async function getAuthorBySlug(slug: string): Promise<Author | null> {
  try {
    const json = await strapiGet<StrapiListResponse<Author>>(
      `/authors?filters[slug][$eq]=${encodeURIComponent(slug)}` +
        `&populate[avatar]=true&${SEO_POPULATE}`,
      { tags: ['authors', `author:${slug}`] },
    );
    return json.data?.[0] ?? null;
  } catch {
    return null;
  }
}

/** 某作者的文章（按发布时间倒序）。 */
export async function getArticlesByAuthor(
  authorSlug: string,
  page = 1,
  pageSize = 20,
): Promise<{ items: ArticleListItem[]; pageCount: number; total: number }> {
  const json = await strapiGet<StrapiListResponse<ArticleListItem>>(
    `/articles?filters[authorRef][slug][$eq]=${encodeURIComponent(authorSlug)}` +
      `&sort[0]=publishAt:desc&sort[1]=publishedAt:desc&${LIST_POPULATE}` +
      `&pagination[page]=${page}&pagination[pageSize]=${pageSize}`,
    { tags: [TAGS.articles, `author:${authorSlug}`] },
  );
  return {
    items: json.data ?? [],
    pageCount: json.meta.pagination?.pageCount ?? 1,
    total: json.meta.pagination?.total ?? (json.data?.length ?? 0),
  };
}

/** 有文章的作者 slug（供 sitemap 用——无文章的作者不入站点地图）。 */
export async function getAllAuthorSlugs(): Promise<string[]> {
  try {
    const json = await strapiGet<StrapiListResponse<{ slug: string }>>(
      `/authors?fields[0]=slug&filters[articles][documentId][$notNull]=true&pagination[pageSize]=200`,
      { tags: ['authors'] },
    );
    return (json.data ?? []).map((a) => a.slug);
  } catch {
    return [];
  }
}

/** 热门排行：按 viewCount 倒序。可按频道或标签过滤（本频道热门 / 本标签热门）。 */
export async function getHotArticles(
  limit = 8,
  filter?: { channelSlug?: string; tagSlug?: string },
): Promise<ArticleListItem[]> {
  let f = '';
  const cacheTags: string[] = [TAGS.articles];
  if (filter?.channelSlug) {
    f += `&filters[channel][slug][$eq]=${encodeURIComponent(filter.channelSlug)}`;
    cacheTags.push(`channel:${filter.channelSlug}`);
  }
  if (filter?.tagSlug) {
    f += `&filters[tags][slug][$eq]=${encodeURIComponent(filter.tagSlug)}`;
    cacheTags.push(`tag:${filter.tagSlug}`);
  }
  try {
    const json = await strapiGet<StrapiListResponse<ArticleListItem>>(
      `/articles?sort=viewCount:desc${f}&${LIST_POPULATE}&pagination[pageSize]=${limit}`,
      { tags: cacheTags },
    );
    return json.data ?? [];
  } catch {
    return [];
  }
}

/** 信息/法律页（后台可编辑）。 */
export async function getPageBySlug(slug: string): Promise<Page | null> {
  try {
    const json = await strapiGet<StrapiListResponse<Page>>(
      `/pages?filters[slug][$eq]=${encodeURIComponent(slug)}&${SEO_POPULATE}`,
      { tags: ['pages', `page:${slug}`] },
    );
    return json.data?.[0] ?? null;
  } catch {
    return null;
  }
}

export async function getAllPageSlugs(): Promise<string[]> {
  try {
    const json = await strapiGet<StrapiListResponse<{ slug: string }>>(
      `/pages?fields[0]=slug&pagination[pageSize]=100`,
      { tags: ['pages'] },
    );
    return (json.data ?? []).map((p) => p.slug);
  } catch {
    return [];
  }
}

/** 取单个标签实体（含简介 + seo），供标签页渲染/metadata 用。 */
export async function getTagBySlug(slug: string): Promise<Tag | null> {
  try {
    const json = await strapiGet<StrapiListResponse<Tag>>(
      `/tags?filters[slug][$eq]=${encodeURIComponent(slug)}&${SEO_POPULATE}`,
      { tags: ['tags', `tag:${slug}`] },
    );
    return json.data?.[0] ?? null;
  } catch {
    return null;
  }
}

/** 热门标签（侧栏标签云 / SEO 内链）。 */
export async function getPopularTags(limit = 12): Promise<Tag[]> {
  try {
    const json = await strapiGet<StrapiListResponse<Tag>>(
      // 仅取「有文章」的标签，避免标签云链向空标签页（404/软 404，§4）
      `/tags?fields[0]=name&fields[1]=slug&filters[articles][documentId][$notNull]=true` +
        `&sort=name:asc&pagination[pageSize]=${limit}`,
      { tags: ['tags'] },
    );
    return json.data ?? [];
  } catch {
    return [];
  }
}

/**
 * 精选标签：按「标签下最热文章的点击数」排序。
 * 取浏览量最高的一批文章，按出现顺序收集其标签——标签即按其最热文章的 viewCount 排列。
 */
export async function getFeaturedTags(limit = 12): Promise<Tag[]> {
  try {
    const json = await strapiGet<StrapiListResponse<ArticleListItem>>(
      `/articles?sort=viewCount:desc&fields[0]=viewCount` +
        `&populate[tags][fields][0]=name&populate[tags][fields][1]=slug` +
        `&pagination[pageSize]=120`,
      { tags: [TAGS.articles, 'tags'], revalidate: 300 },
    );
    const seen = new Set<string>();
    const out: Tag[] = [];
    for (const a of json.data ?? []) {
      for (const t of a.tags ?? []) {
        if (t.slug && !seen.has(t.slug)) {
          seen.add(t.slug);
          out.push(t as Tag);
          if (out.length >= limit) return out;
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** 广告位（§M6）：按 key 取「启用且在投放时间窗内」的推荐位。 */
export async function getAdSlot(key: string): Promise<AdSlot | null> {
  try {
    const json = await strapiGet<StrapiListResponse<AdSlot>>(
      `/ad-slots?filters[key][$eq]=${encodeURIComponent(key)}` +
        `&filters[enabled][$eq]=true&populate[image]=true`,
      { tags: [TAGS.adslots, `adslot:${key}`] },
    );
    const now = Date.now();
    const slot = (json.data ?? []).find((s) => {
      const okStart = !s.startAt || new Date(s.startAt).getTime() <= now;
      const okEnd = !s.endAt || new Date(s.endAt).getTime() >= now;
      return okStart && okEnd;
    });
    return slot ?? null;
  } catch {
    return null;
  }
}

/** 上一篇/下一篇：同频道、按发布时间相邻（上一篇=较新，下一篇=较旧）。 */
export async function getAdjacentArticles(
  channelSlug: string,
  publishAt: string | null | undefined,
  currentSlug: string,
): Promise<{ prev: ArticleListItem | null; next: ArticleListItem | null }> {
  if (!publishAt) return { prev: null, next: null };
  const c = encodeURIComponent(channelSlug);
  const p = encodeURIComponent(publishAt);
  const s = encodeURIComponent(currentSlug);
  const base =
    `/articles?filters[channel][slug][$eq]=${c}&filters[slug][$ne]=${s}` +
    `&fields[0]=title&fields[1]=slug&populate[channel][fields][0]=slug&pagination[pageSize]=1`;
  try {
    const [newer, older] = await Promise.all([
      strapiGet<StrapiListResponse<ArticleListItem>>(
        `${base}&filters[publishAt][$gt]=${p}&sort=publishAt:asc`,
        { tags: [TAGS.articles, `channel:${channelSlug}`] },
      ),
      strapiGet<StrapiListResponse<ArticleListItem>>(
        `${base}&filters[publishAt][$lt]=${p}&sort=publishAt:desc`,
        { tags: [TAGS.articles, `channel:${channelSlug}`] },
      ),
    ]);
    return { prev: newer.data?.[0] ?? null, next: older.data?.[0] ?? null };
  } catch {
    return { prev: null, next: null };
  }
}

/** 相关推荐：同频道、排除当前文章，按时间倒序（§ M3 相关推荐）。 */
/**
 * 相关推荐：① 按「共享标签数」相关（重叠多优先，同重叠保持发布时间序）；
 * ② 不足 limit 时用「同频道最新」去重兜满。tagSlugs 传当前文章的标签。
 */
export async function getRelatedArticles(
  channelSlug: string,
  excludeSlug: string,
  tagSlugs: string[] = [],
  limit = 6,
): Promise<ArticleListItem[]> {
  try {
    const picked = new Map<string, ArticleListItem>();

    // ① 标签相关
    const tags = tagSlugs.filter(Boolean);
    if (tags.length) {
      const inFilter = tags
        .map((s, i) => `filters[tags][slug][$in][${i}]=${encodeURIComponent(s)}`)
        .join('&');
      const json = await strapiGet<StrapiListResponse<ArticleListItem>>(
        `/articles?${inFilter}&filters[slug][$ne]=${encodeURIComponent(excludeSlug)}` +
          `&${LIST_POPULATE}&populate[tags][fields][0]=slug` +
          `&sort[0]=publishAt:desc&pagination[pageSize]=${limit * 4}`,
        { tags: [TAGS.articles] },
      );
      const wanted = new Set(tags);
      const ranked = (json.data ?? [])
        .map((a) => ({ a, overlap: (a.tags ?? []).filter((t) => wanted.has(t.slug)).length }))
        .sort((x, y) => y.overlap - x.overlap); // sort 稳定 → 同重叠保留时间序
      for (const { a } of ranked) {
        picked.set(a.slug, a);
        if (picked.size >= limit) break;
      }
    }

    // ② 同频道最新兜底
    if (picked.size < limit) {
      const json = await strapiGet<StrapiListResponse<ArticleListItem>>(
        `/articles?filters[channel][slug][$eq]=${encodeURIComponent(channelSlug)}` +
          `&filters[slug][$ne]=${encodeURIComponent(excludeSlug)}` +
          `&sort[0]=publishAt:desc&sort[1]=publishedAt:desc&${LIST_POPULATE}` +
          `&pagination[pageSize]=${limit + picked.size}`,
        { tags: [TAGS.articles, `channel:${channelSlug}`] },
      );
      for (const a of json.data ?? []) {
        if (!picked.has(a.slug)) picked.set(a.slug, a);
        if (picked.size >= limit) break;
      }
    }

    return [...picked.values()].slice(0, limit);
  } catch {
    return [];
  }
}

/** 近期文章（含正文），供 Yandex Turbo RSS 用（§4 MAY）。 */
export async function getRecentArticlesWithContent(limit = 30): Promise<Article[]> {
  try {
    const json = await strapiGet<StrapiListResponse<Article>>(
      `/articles?sort[0]=publishAt:desc&sort[1]=publishedAt:desc&populate[channel][fields][0]=slug&populate[channel][fields][1]=name` +
        `&populate[cover]=true&pagination[pageSize]=${limit}`,
      { tags: [TAGS.articles], revalidate: 300 },
    );
    return (json.data ?? []).filter((a) => a.channel?.slug);
  } catch {
    return [];
  }
}

/** 全站文章（slug + 频道 + 时间），供 sitemap / generateStaticParams 用。 */
export async function getAllArticlesForSitemap(): Promise<
  Array<Pick<Article, 'slug' | 'updatedAt' | 'publishAt' | 'title'> & { channelSlug: string }>
> {
  try {
    const json = await strapiGet<StrapiListResponse<Article>>(
      `/articles?fields[0]=slug&fields[1]=updatedAt&fields[2]=publishAt&fields[3]=title` +
        `&populate[channel][fields][0]=slug&sort[0]=publishAt:desc&sort[1]=publishedAt:desc&pagination[pageSize]=500`,
      { tags: [TAGS.articles], revalidate: 300 },
    );
    return (json.data ?? [])
      .filter((a) => a.channel?.slug)
      .map((a) => ({
        slug: a.slug,
        updatedAt: a.updatedAt,
        publishAt: a.publishAt,
        title: a.title,
        channelSlug: a.channel!.slug,
      }));
  } catch {
    return [];
  }
}

/** 已发布文章总数（供 sitemap index 计算分片数）。 */
export async function getArticleCount(): Promise<number> {
  try {
    const json = await strapiGet<StrapiListResponse<{ slug: string }>>(
      `/articles?fields[0]=slug&pagination[pageSize]=1`,
      { tags: [TAGS.articles], revalidate: 300 },
    );
    return json.meta.pagination?.total ?? 0;
  } catch {
    return 0;
  }
}

/** 分片取文章（供分层 sitemap 的某一片）。 */
export async function getArticlesForSitemap(
  page: number,
  pageSize: number,
): Promise<Array<Pick<Article, 'slug' | 'updatedAt' | 'publishAt'> & { channelSlug: string }>> {
  try {
    const json = await strapiGet<StrapiListResponse<Article>>(
      `/articles?fields[0]=slug&fields[1]=updatedAt&fields[2]=publishAt` +
        `&populate[channel][fields][0]=slug&sort[0]=publishAt:desc&sort[1]=publishedAt:desc` +
        `&pagination[page]=${page}&pagination[pageSize]=${pageSize}`,
      { tags: [TAGS.articles], revalidate: 300 },
    );
    return (json.data ?? [])
      .filter((a) => a.channel?.slug)
      .map((a) => ({
        slug: a.slug,
        updatedAt: a.updatedAt,
        publishAt: a.publishAt,
        channelSlug: a.channel!.slug,
      }));
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────
// 首页模块编排（§5：区块顺序/variant 由后台数据驱动，前台 MUST NOT 硬编码栏目）
//
// M3：优先读取后台「HomePage 编排」单类型——区块顺序、标题、variant、取数量全由编辑配置。
// 若编排为空，回退到「按上导航频道自动生成」（M1 行为），保证永不空屏。
// ─────────────────────────────────────────────────────────────

export async function getHomePageLayout(): Promise<HomePageLayout | null> {
  try {
    const json = await strapiGet<StrapiSingleResponse<HomePageLayout>>(
      `/home-page?populate[blocks][populate][channel][fields][0]=slug` +
        `&populate[blocks][populate][channel][fields][1]=name`,
      { tags: [TAGS.home, TAGS.channels] },
    );
    return json.data ?? null;
  } catch {
    return null;
  }
}

const VARIANT_CYCLE: BlockVariant[] = ['left-text-right-image', 'three-image', 'text-only'];

export async function getHomeBlocks(): Promise<HomeBlock[]> {
  // 1) 后台编排优先
  const layout = await getHomePageLayout();
  if (layout?.blocks?.length) {
    const blocks = await Promise.all(
      layout.blocks.map(async (b, idx): Promise<HomeBlock | null> => {
        const slug = b.channel?.slug;
        if (!slug) return null;
        const { items } = await getArticlesByChannel(slug, 1, b.limit ?? 4);
        if (items.length === 0) return null;
        return { title: b.title, channelSlug: slug, order: idx, variant: b.variant, items };
      }),
    );
    return blocks.filter((b): b is HomeBlock => b !== null);
  }

  // 2) 回退：按上导航频道自动生成
  const channels = await getNavChannels();
  const blocks = await Promise.all(
    channels.map(async (ch, idx): Promise<HomeBlock | null> => {
      const { items } = await getArticlesByChannel(ch.slug, 1, idx === 0 ? 5 : 4);
      if (items.length === 0) return null;
      return {
        title: ch.name,
        channelSlug: ch.slug,
        order: ch.order ?? idx,
        variant: idx === 0 ? 'hero' : VARIANT_CYCLE[(idx - 1) % VARIANT_CYCLE.length],
        items,
      };
    }),
  );
  return blocks.filter((b): b is HomeBlock => b !== null).sort((a, b) => a.order - b.order);
}
