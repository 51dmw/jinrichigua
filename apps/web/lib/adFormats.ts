import type { AdFormat } from 'shared';

/**
 * 广告外链的 SEO 友好默认属性（全站广告链接唯一来源）。
 * - rel="sponsored"：向 Google 声明这是「付费/广告链接」（Google 对广告链接的硬性要求）；
 * - nofollow：不传递权重（与 sponsored 双保险，兼容旧爬虫）；
 * - noopener noreferrer：新窗口打开时阻止 window.opener 劫持并不泄露来源（安全）。
 * 配合 target="_blank" 使用。
 */
export const AD_LINK_REL = 'sponsored nofollow noopener noreferrer';
export const AD_LINK_TARGET = '_blank';

/**
 * 广告位标准尺寸表（§M6）——所有广告占位的唯一来源。
 * 每种格式固定宽高比 + next/image sizes，渲染前即预留高度 → CLS≈0。
 * 运营在后台选 format 即所见即所得，无需研发改代码。
 */
export interface AdFormatSpec {
  label: string;
  /** 推荐创意尺寸（像素），用于后台提示与占位 */
  width: number;
  height: number;
  /** CSS aspect-ratio 值（容器按此预留高度，防布局抖动）*/
  ratio: string;
  /** next/image 的 sizes：按断点给浏览器选图，避免过载 */
  sizes: string;
  /** 容器最大宽度（内联 style，避免依赖 Tailwind 扫描任意值）。null=占满 */
  maxWidth: string | null;
  /** 响应式可见性 class（半屏仅桌面、悬浮仅移动），见 tailwind safelist */
  visibility: string;
}

export const AD_FORMATS: Record<AdFormat, AdFormatSpec> = {
  leaderboard: {
    label: '顶部横幅 728×90',
    width: 728,
    height: 90,
    ratio: '728 / 90',
    sizes: '(max-width: 768px) 100vw, 728px',
    maxWidth: null,
    visibility: '',
  },
  'in-feed': {
    label: '信息流原生 1200×628',
    width: 1200,
    height: 628,
    ratio: '1200 / 628',
    sizes: '(max-width: 768px) 100vw, 640px',
    maxWidth: null,
    visibility: '',
  },
  rectangle: {
    label: '侧栏矩形 300×250',
    width: 300,
    height: 250,
    ratio: '300 / 250',
    sizes: '300px',
    maxWidth: '300px',
    visibility: '',
  },
  'half-page': {
    label: '侧栏半屏 300×600',
    width: 300,
    height: 600,
    ratio: '300 / 600',
    sizes: '300px',
    maxWidth: '300px',
    visibility: 'hidden lg:block', // 半屏仅桌面
  },
  anchor: {
    label: '移动悬浮 320×50',
    width: 320,
    height: 50,
    ratio: '320 / 50',
    sizes: '320px',
    maxWidth: '320px',
    visibility: 'lg:hidden', // 悬浮仅移动
  },
};

export function adFormatSpec(format?: AdFormat | null): AdFormatSpec {
  return AD_FORMATS[(format ?? 'leaderboard') as AdFormat] ?? AD_FORMATS.leaderboard;
}

/**
 * 全站广告位目录 —— 位置的唯一来源。
 * 一个 page 下多个位置（多位置），每个位置可排多张演示展位图（同位置多图，轮播）。
 * 新增/挪动广告位只改这里：AD_SLOTS 与 /ads-preview 总览页都从它派生。
 */
export interface AdSlotEntry {
  key: string;
  format: AdFormat;
  /** 位置说明（后台/总览页可读） */
  where: string;
  /** 演示展位图张数（>1 则前台轮播） */
  demo: number;
}

/**
 * 总览页「查看实际页面」的链接类型。
 * 只记类型不记路径：频道/文章/作者/标签都是动态 slug，写死路径必然 404
 * （站内没有 /news、/author、/tag 这类索引页），运行时现查一个真实 slug 拼。
 */
export type AdSamplePageKind = 'home' | 'channel' | 'article' | 'hot' | 'author' | 'tag' | 'search';

export interface AdSlotPage {
  /** 页面名 */
  page: string;
  /** 该页面的示例链接类型（总览页据此解析出一个真实可访问的 URL） */
  sampleKind: AdSamplePageKind;
  slots: AdSlotEntry[];
}

export const AD_SLOT_CATALOG: AdSlotPage[] = [
  {
    page: '首页',
    sampleKind: 'home',
    slots: [
      { key: 'home-top', format: 'leaderboard', where: '导航下方首屏横幅', demo: 3 },
      { key: 'home-feed-1', format: 'in-feed', where: '信息流第 1 屏内嵌', demo: 2 },
      { key: 'home-feed-2', format: 'in-feed', where: '信息流第 3 条后内嵌', demo: 2 },
      { key: 'home-anchor', format: 'anchor', where: '移动端底部悬浮条', demo: 2 },
    ],
  },
  {
    page: '频道页',
    sampleKind: 'channel',
    slots: [
      { key: 'channel-top', format: 'leaderboard', where: '频道标题下方横幅', demo: 3 },
      { key: 'channel-mid', format: 'in-feed', where: '列表第 6 条后内嵌', demo: 2 },
      { key: 'channel-aside', format: 'rectangle', where: '右侧栏「频道热门」下方', demo: 3 },
      { key: 'channel-anchor', format: 'anchor', where: '移动端底部悬浮条', demo: 2 },
    ],
  },
  {
    page: '文章页',
    sampleKind: 'article',
    slots: [
      { key: 'article-inline', format: 'in-feed', where: '正文中部段落间', demo: 3 },
      { key: 'article-bottom', format: 'leaderboard', where: '正文末尾（相关阅读前）', demo: 2 },
      { key: 'article-aside', format: 'rectangle', where: '右侧栏「频道热门」下方', demo: 3 },
      { key: 'article-aside-2', format: 'half-page', where: '右侧栏「频道最新」下方（仅桌面）', demo: 2 },
      { key: 'article-anchor', format: 'anchor', where: '移动端底部悬浮条', demo: 2 },
    ],
  },
  {
    page: '热榜页',
    sampleKind: 'hot',
    slots: [
      { key: 'hot-top', format: 'leaderboard', where: '榜单上方横幅', demo: 2 },
      { key: 'hot-aside', format: 'rectangle', where: '右侧栏标签云上方', demo: 3 },
    ],
  },
  {
    page: '作者页',
    sampleKind: 'author',
    slots: [{ key: 'author-aside', format: 'rectangle', where: '右侧栏', demo: 2 }],
  },
  {
    page: '标签页',
    sampleKind: 'tag',
    slots: [{ key: 'tag-aside', format: 'rectangle', where: '右侧栏', demo: 2 }],
  },
  {
    page: '搜索页',
    sampleKind: 'search',
    slots: [
      { key: 'search-top', format: 'leaderboard', where: '搜索框下方横幅', demo: 2 },
      { key: 'search-feed', format: 'in-feed', where: '结果第 6 条后内嵌', demo: 2 },
    ],
  },
];

/** 全站广告位 key → 目录条目（与 CMS bootstrap 播种的 key 一致）。 */
export const AD_SLOT_ENTRIES: Record<string, AdSlotEntry> = Object.fromEntries(
  AD_SLOT_CATALOG.flatMap((p) => p.slots.map((s) => [s.key, s])),
);

/**
 * 全站广告位 key → format 映射（由目录派生）。
 * 占位图模式下据此推断尺寸，无需查库。
 */
export const AD_SLOTS: Record<string, AdFormat> = Object.fromEntries(
  Object.entries(AD_SLOT_ENTRIES).map(([k, s]) => [k, s.format]),
);

/** 取某广告位的 format：优先后台值，回退静态映射，再回退 leaderboard。 */
export function formatForSlot(slotKey: string, dbFormat?: AdFormat | null): AdFormat {
  return (dbFormat ?? AD_SLOTS[slotKey] ?? 'leaderboard') as AdFormat;
}

// ─────────────────────────────────────────────────────────────
// 演示展位图（无真实创意时的可视化预览）
// ─────────────────────────────────────────────────────────────

/** 未登记的位置默认排几张展位图 */
export const AD_DEMO_DEFAULT_COUNT = 2;

/** 单张展位图 URL（SVG 由 /ads/placeholder 路由按尺寸现生成，零素材）。 */
export function adPlaceholderSrc(slotKey: string, variant: number, format?: AdFormat): string {
  const q = new URLSearchParams({ slot: slotKey, v: String(variant) });
  if (format) q.set('format', format);
  return `/ads/placeholder?${q.toString()}`;
}

/** 位置 key → 稳定小整数，用于轮播错峰（服务端与客户端结果必须一致）。 */
export function slotSeed(slotKey: string): number {
  let n = 0;
  for (let i = 0; i < slotKey.length; i += 1) n = (n * 31 + slotKey.charCodeAt(i)) % 997;
  return n;
}

/** 某位置的全部展位图（长度 >1 时前台轮播，即「同位置多展示图」）。 */
export function adDemoSrcs(slotKey: string, format?: AdFormat | null): string[] {
  const entry = AD_SLOT_ENTRIES[slotKey];
  const n = Math.max(1, entry?.demo ?? AD_DEMO_DEFAULT_COUNT);
  const fmt = (format ?? entry?.format) as AdFormat | undefined;
  return Array.from({ length: n }, (_, i) => adPlaceholderSrc(slotKey, i + 1, fmt));
}
