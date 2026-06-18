import type { MetadataRoute } from 'next';

// PWA 清单（Next 自动注入 <link rel="manifest">）。
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '今日吃瓜',
    short_name: '今日吃瓜',
    description: '聚合每日热点与全网热搜的吃瓜资讯站。',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#c1272d',
    lang: 'zh-CN',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
    ],
  };
}
