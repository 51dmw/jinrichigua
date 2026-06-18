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
