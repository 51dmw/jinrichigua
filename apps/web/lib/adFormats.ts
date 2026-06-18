import type { AdFormat } from 'shared';

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
 * 全站广告位 key → format 映射（与 CMS bootstrap 播种一致）。
 * 占位图模式下据此推断尺寸，无需查库。
 */
export const AD_SLOTS: Record<string, AdFormat> = {
  'home-top': 'leaderboard',
  'home-feed-1': 'in-feed',
  'home-feed-2': 'in-feed',
  'home-anchor': 'anchor',
  'channel-top': 'leaderboard',
  'channel-mid': 'in-feed',
  'channel-aside': 'rectangle',
  'channel-anchor': 'anchor',
  'article-inline': 'in-feed',
  'article-bottom': 'leaderboard',
  'article-aside': 'rectangle',
  'article-aside-2': 'half-page',
  'article-anchor': 'anchor',
  'hot-top': 'leaderboard',
  'hot-aside': 'rectangle',
  'author-aside': 'rectangle',
  'tag-aside': 'rectangle',
  'search-top': 'leaderboard',
  'search-feed': 'in-feed',
};

/** 取某广告位的 format：优先后台值，回退静态映射，再回退 leaderboard。 */
export function formatForSlot(slotKey: string, dbFormat?: AdFormat | null): AdFormat {
  return (dbFormat ?? AD_SLOTS[slotKey] ?? 'leaderboard') as AdFormat;
}
