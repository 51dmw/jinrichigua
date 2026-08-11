// 集中读取环境变量，统一兜底（§9 所有配置 env 驱动）。

export const SITE_URL = (process.env.SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
export const STRAPI_API_URL = (process.env.STRAPI_API_URL ?? 'http://localhost:1337').replace(
  /\/$/,
  '',
);
export const STRAPI_API_TOKEN = process.env.STRAPI_API_TOKEN ?? '';

/**
 * 友链埋点共享密钥（友链统计第1期）。服务端调用 Strapi /api/friend-link/track 时
 * 带 x-friend-track-secret 头，MUST 与 apps/cms 的 FRIEND_TRACK_SECRET 一致。
 * 留空则前台不发埋点请求（开发环境无需配置）。
 */
export const FRIEND_TRACK_SECRET = process.env.FRIEND_TRACK_SECRET ?? '';
export const REVALIDATE_TOKEN = process.env.REVALIDATE_TOKEN ?? '';
export const REVALIDATE_SECONDS = Number(process.env.REVALIDATE_SECONDS ?? 120);

/** IndexNow 密钥（§4 MUST：Yandex + Bing 即时收录）。留空则不推送。 */
export const INDEXNOW_KEY = process.env.INDEXNOW_KEY ?? '';

/** 站点主语言（§4 hreflang 预留） */
export const SITE_LOCALE = process.env.SITE_LOCALE ?? 'zh-CN';

/**
 * Cloudflare Turnstile（无感人机验证，§1 评论防刷）。
 * 两者都留空则**自动跳过验证**（本地开发无需配置）。
 * 站点密钥经服务端注入客户端组件，无需 NEXT_PUBLIC_ 前缀。
 * 本地联调可用官方测试密钥：site=1x00000000000000000000AA / secret=1x0000000000000000000000000000000AA（恒通过）。
 */
export const TURNSTILE_SITE_KEY = process.env.TURNSTILE_SITE_KEY ?? '';
export const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY ?? '';

/**
 * 广告位展位图模式（§M6 预览/验收用）。
 * 开启后，所有无创意的广告位渲染「演示展位图」（按 format 标准尺寸现生成 SVG，
 * 同位置多张则轮播，点击跳 SITE_URL），方便整站可视化广告布局。
 * 生产留空/0 → 仍是「无创意不渲染」。总览页 /ads-preview 不受此开关影响。
 */
export const ADS_PLACEHOLDER = ['1', 'true', 'on'].includes(
  (process.env.ADS_PLACEHOLDER ?? '').toLowerCase(),
);
