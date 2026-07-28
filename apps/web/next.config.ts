import type { NextConfig } from 'next';

// Strapi 媒体主机（next/image 远程白名单，§5 图片走 next/image）。
const strapiUrl = process.env.STRAPI_API_URL ?? 'http://localhost:1337';
const { hostname, protocol } = new URL(strapiUrl);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 构建输出目录可覆盖（安全部署用）：构建时写临时目录，成功后原子切换到 .next，
  // 失败绝不污染线上运行的 .next。运行(next start)用默认 .next，见 scripts/deploy-web.sh。
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // URL 规范化（SEO）：统一「无结尾斜杠」。
  trailingSlash: false,
  // 关掉 Next 自带的尾斜杠跳转，交给 middleware 一次性处理(小写+去尾斜杠+去重斜杠)，避免多跳。
  skipTrailingSlashRedirect: true,
  // 不对外暴露技术栈（移除 X-Powered-By: Next.js）。
  poweredByHeader: false,
  // 旧短路径 → 信息页（301 永久跳转，消除 404 / 集中权重，§4 SEO）。
  async redirects() {
    const map: Record<string, string> = {
      '/about': '/info/about',
      '/contact': '/info/contact',
      '/privacy': '/info/privacy',
      '/terms': '/info/terms',
      '/faq': '/info/faq',
      '/dmca': '/info/dmca',
    };
    return Object.entries(map).map(([source, destination]) => ({
      source,
      destination,
      statusCode: 301, // 严格 301（而非 permanent:true 的 308）
    }));
  },
  // 安全响应头（HSTS/CSP 交给 Cloudflare/Nginx，此处仅基础四项；代码化便于 CF Workers 部署复用）。
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'geolocation=(), camera=(), microphone=()' },
        ],
      },
    ];
  },
  images: {
    // 现代格式（SEO/LCP）：优先 AVIF，回退 WebP，再回退原图。
    formats: ['image/avif', 'image/webp'],
    // 砍掉 2048/3840 两档（Next 默认到 3840）。全站声明的 sizes 最大是
    // 「(max-width: 640px) 100vw, 640px」，即最宽 640 CSS px，DPR 3 也只需要 1920，
    // 2048/3840 两档永远不会被浏览器选中，只是让每个 srcSet 白白多两条候选。
    // 首页 20+ 张图，每条候选约 130 字符 → 省下约 5KB HTML（gzip 前）。
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    // 与 Next 默认一致，显式写出来防止以后误改（112px/88px 的小图靠这组出候选）。
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    remotePatterns: [
      {
        protocol: protocol.replace(':', '') as 'http' | 'https',
        hostname,
      },
      // R2 媒体域（M5：Strapi 上传已切 R2，见 apps/cms/config/plugins.ts）
      { protocol: 'https', hostname: 'img.sibian.xyz' },
    ],
  },
};

export default nextConfig;
