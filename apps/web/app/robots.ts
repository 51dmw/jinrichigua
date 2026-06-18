import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/env';

// /robots.txt —— 引用两份 sitemap（§4 MUST）。
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // 站内搜索结果不收录（§4 避免重复/低质页）
        disallow: ['/api/', '/search'],
      },
    ],
    sitemap: [`${SITE_URL}/sitemap.xml`, `${SITE_URL}/news-sitemap.xml`],
    host: SITE_URL,
  };
}
