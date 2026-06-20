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
      // 有害/激进爬虫全屏蔽：Bytespider 吃带宽，MJ12bot/DotBot 纯外链采集，对本站 SEO 无贡献。
      {
        userAgent: ['Bytespider', 'MJ12bot', 'DotBot'],
        disallow: '/',
      },
    ],
    sitemap: [`${SITE_URL}/sitemap.xml`, `${SITE_URL}/news-sitemap.xml`],
    host: SITE_URL,
  };
}
