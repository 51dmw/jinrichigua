import type { NextConfig } from 'next';

// Strapi 媒体主机（next/image 远程白名单，§5 图片走 next/image）。
const strapiUrl = process.env.STRAPI_API_URL ?? 'http://localhost:1337';
const { hostname, protocol } = new URL(strapiUrl);

const nextConfig: NextConfig = {
  reactStrictMode: true,
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
    remotePatterns: [
      {
        protocol: protocol.replace(':', '') as 'http' | 'https',
        hostname,
      },
      // R2 / CDN 公网域名（M5 启用后按需补充）
      // { protocol: 'https', hostname: 'media.example.com' },
    ],
  },
};

export default nextConfig;
