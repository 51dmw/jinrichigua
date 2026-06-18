/**
 * 前后台共享类型 — 单一事实来源（§9）。
 *
 * 这些类型描述「前台从 Strapi REST API 拿到的、已扁平化的领域对象」。
 * Strapi 5 使用 `documentId` 作为稳定标识（§1）。本包刻意不依赖 Strapi 的
 * 原始 `{ data: { attributes } }` 包裹结构 —— 扁平化由前台 `lib/strapi` 完成，
 * 这里只描述领域模型，供前后台对齐。
 */

// ─────────────────────────────────────────────────────────────
// 基础
// ─────────────────────────────────────────────────────────────

export interface StrapiEntityMeta {
  /** Strapi 5 稳定文档标识 */
  documentId: string;
  /** 数字主键（仅内部用，URL MUST NOT 使用，见 §4） */
  id: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export interface MediaImage {
  url: string;
  alternativeText?: string | null;
  width?: number | null;
  height?: number | null;
  mime?: string | null;
  formats?: Record<string, { url: string; width: number; height: number }> | null;
}

// ─────────────────────────────────────────────────────────────
// SEO 组件 (seo.meta-data) — §3
// ─────────────────────────────────────────────────────────────

export type StructuredDataType = 'NewsArticle' | 'Article' | 'none';
export type TwitterCardType = 'summary' | 'summary_large_image';

export interface SeoRobots {
  index: boolean;
  follow: boolean;
}

export interface SeoMetaData {
  metaTitle?: string | null;
  metaDescription?: string | null;
  keywords?: string | null;
  canonicalURL?: string | null;
  robots?: SeoRobots | null;
  ogTitle?: string | null;
  ogDescription?: string | null;
  ogImage?: MediaImage | null;
  twitterCard?: TwitterCardType | null;
  structuredDataType?: StructuredDataType | null;
  /** 可选：手动覆盖自动生成的 JSON-LD */
  structuredDataJSON?: Record<string, unknown> | null;
}

// ─────────────────────────────────────────────────────────────
// Channel 频道 — §3
// ─────────────────────────────────────────────────────────────

export interface Channel extends StrapiEntityMeta {
  name: string;
  slug: string;
  order: number;
  /** 是否出现在顶部导航 */
  isNav: boolean;
  /** 频道简介（SEO：给频道页补成段文本 + 主题关键词） */
  description?: string | null;
  parent?: Pick<Channel, 'documentId' | 'name' | 'slug'> | null;
  children?: Array<Pick<Channel, 'documentId' | 'name' | 'slug' | 'order'>>;
  seo?: SeoMetaData | null;
}

// ─────────────────────────────────────────────────────────────
// Tag 标签 — §3
// ─────────────────────────────────────────────────────────────

export interface Tag extends StrapiEntityMeta {
  name: string;
  slug: string;
  /** 标签简介（SEO：缓解聚合页薄内容） */
  description?: string | null;
  seo?: SeoMetaData | null;
}

// ─────────────────────────────────────────────────────────────
// Author 作者（E-E-A-T）
// ─────────────────────────────────────────────────────────────

export interface Author extends StrapiEntityMeta {
  name: string;
  slug: string;
  /** 头衔，如「资深编辑」 */
  role?: string | null;
  bio?: string | null;
  avatar?: MediaImage | null;
  seo?: SeoMetaData | null;
}

// ─────────────────────────────────────────────────────────────
// Article 文章 — §3
// ─────────────────────────────────────────────────────────────

export interface Article extends StrapiEntityMeta {
  title: string;
  slug: string;
  summary?: string | null;
  /** 富文本 HTML/Blocks，前台按需渲染 */
  content?: string | null;
  cover?: MediaImage | null;
  channel?: Pick<Channel, 'documentId' | 'name' | 'slug'> | null;
  tags?: Array<Pick<Tag, 'documentId' | 'name' | 'slug'>>;
  /** 旧的纯字符串作者（兜底）；优先用 authorRef 实体 */
  author?: string | null;
  authorRef?: Pick<Author, 'documentId' | 'name' | 'slug' | 'role' | 'avatar' | 'bio'> | null;
  source?: string | null;
  /** 业务意义上的发布时间（可定时，§6），不等于 Strapi publishedAt */
  publishAt?: string | null;
  viewCount?: number | null;
  seo?: SeoMetaData | null;
}

/** 列表/信息流场景下的精简文章（不含正文，省流量） */
export type ArticleListItem = Omit<Article, 'content'>;

// ─────────────────────────────────────────────────────────────
// Comment 文章评论（先审后发，§6）
// ─────────────────────────────────────────────────────────────

export interface Comment extends StrapiEntityMeta {
  content: string;
  authorName?: string | null;
  approved: boolean;
}

// ─────────────────────────────────────────────────────────────
// AdSlot 推荐位 — §3
// ─────────────────────────────────────────────────────────────

/** 广告位格式 → 标准占位尺寸（横幅/信息流/矩形/半屏/移动悬浮），用于防 CLS。 */
export type AdFormat = 'leaderboard' | 'in-feed' | 'rectangle' | 'half-page' | 'anchor';

export interface AdSlot extends StrapiEntityMeta {
  /** 位置标识，如 home-top / channel-mid */
  key: string;
  title?: string | null;
  image?: MediaImage | null;
  link?: string | null;
  enabled: boolean;
  /** 占位格式（决定宽高比与 next/image sizes），缺省按 leaderboard */
  format?: AdFormat | null;
  startAt?: string | null;
  endAt?: string | null;
}

// ─────────────────────────────────────────────────────────────
// Global 站点设置 (Single Type) — §3
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// Page 信息/法律页（后台可编辑）
// ─────────────────────────────────────────────────────────────

export interface Page extends StrapiEntityMeta {
  title: string;
  slug: string;
  body?: string | null;
  seo?: SeoMetaData | null;
}

export interface GlobalSettings {
  siteName: string;
  /** 如 "%s | 站名" */
  titleTemplate?: string | null;
  /** 首页底部站点简介（SEO：给首页补成段文本 + 主题关键词） */
  homeIntro?: string | null;
  /** 文章页免责声明（后台可编辑） */
  disclaimer?: string | null;
  defaultOgImage?: MediaImage | null;
  defaultRobots?: SeoRobots | null;
  /** 各搜索引擎站长验证码 */
  googleSiteVerification?: string | null;
  yandexSiteVerification?: string | null;
  bingSiteVerification?: string | null;
  /** Yandex.Metrica 计数器 ID（§4 SHOULD） */
  yandexMetricaId?: string | null;
  /** 大陆合规：ICP 备案号（§8） */
  icpRecord?: string | null;
  defaultSeo?: SeoMetaData | null;
}

// ─────────────────────────────────────────────────────────────
// 首页模块编排 — §5（区块顺序 + variant 由后台驱动）
// ─────────────────────────────────────────────────────────────

export type BlockVariant =
  | 'hero'
  | 'image-top'
  | 'left-text-right-image'
  | 'three-image'
  | 'text-only';

export interface HomeBlock {
  /** 区块标题（通常对应某频道/栏目） */
  title: string;
  channelSlug?: string | null;
  variant: BlockVariant;
  order: number;
  items: ArticleListItem[];
}

/** 后台「首页编排」单类型里的一个区块配置（§5 数据驱动来源）。 */
export interface HomeLayoutBlock {
  title: string;
  channel?: Pick<Channel, 'documentId' | 'name' | 'slug'> | null;
  variant: BlockVariant;
  limit: number;
}

export interface HomePageLayout {
  blocks: HomeLayoutBlock[];
}

// ─────────────────────────────────────────────────────────────
// API 包裹（Strapi REST 原始响应形态，前台扁平化前用）
// ─────────────────────────────────────────────────────────────

export interface StrapiListResponse<T> {
  data: T[];
  meta: {
    pagination?: {
      page: number;
      pageSize: number;
      pageCount: number;
      total: number;
    };
  };
}

export interface StrapiSingleResponse<T> {
  data: T;
  meta: Record<string, unknown>;
}
