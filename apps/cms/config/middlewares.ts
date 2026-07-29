// CORS MUST 锁定到前台域名，禁止 *（§7）。
// 中间件配置文件导出数组，env 通过 process.env 读取。
const corsOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// R2 媒体域（后台媒体库预览需放行 img-src/media-src）
const mediaHost = (process.env.R2_PUBLIC_URL || '').replace(/^https?:\/\//, '');

export default [
  'strapi::logger',
  'strapi::errors',
  {
    name: 'strapi::security',
    config: {
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'img-src': ["'self'", 'data:', 'blob:', 'market-assets.strapi.io', ...(mediaHost ? [mediaHost] : [])],
          'media-src': ["'self'", 'data:', 'blob:', ...(mediaHost ? [mediaHost] : [])],
          upgradeInsecureRequests: null,
        },
      },
    },
  },
  {
    name: 'strapi::cors',
    config: {
      origin: corsOrigins,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
      headers: ['Content-Type', 'Authorization', 'Origin', 'Accept'],
      keepHeaderOnError: true,
    },
  },
  'strapi::poweredBy',
  'strapi::query',
  'strapi::body',
  'global::convert-upload-webp', // 上传图片落盘前自动转 WebP（须在 body 解析之后）
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
];
