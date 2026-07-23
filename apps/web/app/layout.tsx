import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import './globals.css';
import { getGlobal, getNavChannels } from '@/lib/strapi';
import { buildSiteMetadata, organizationJsonLd, websiteJsonLd } from '@/lib/seo';
import { ChannelNav } from '@/components/ChannelNav';
import { SiteFooter } from '@/components/SiteFooter';
import { Analytics } from '@/components/Analytics';
import { JsonLd } from '@/components/JsonLd';
import { Logo } from '@/components/Logo';
import { STRAPI_API_URL } from '@/lib/env';

export async function generateMetadata(): Promise<Metadata> {
  const global = await getGlobal();
  return buildSiteMetadata(global);
}

// 移动优先视口 + 品牌主题色（移动浏览器地址栏着色）。
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#c1272d',
  colorScheme: 'light',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [global, channels] = await Promise.all([getGlobal(), getNavChannels()]);
  const siteName = global?.siteName ?? 'News Portal';

  return (
    <html lang="zh-CN">
      <head>
        {/* 关掉 iOS 把数字/日期自动识别成电话链接（中文正文常见误伤） */}
        <meta name="format-detection" content="telephone=no" />
        {/* RSS 订阅源自动发现（阅读器/聚合识别）*/}
        <link rel="alternate" type="application/rss+xml" title={`${siteName} RSS`} href="/rss.xml" />
        {/* 提前与跨域来源建连，加速媒体图片/统计加载（Next 会去重并提升到 <head>）*/}
        <link rel="preconnect" href={STRAPI_API_URL} crossOrigin="" />
        {global?.yandexMetricaId ? (
          <link rel="preconnect" href="https://mc.yandex.ru" crossOrigin="" />
        ) : null}
      </head>
      <body>
        {/* 站点级实体（§4 SEO）：Organization + WebSite */}
        <JsonLd data={organizationJsonLd(global)} />
        <JsonLd data={websiteJsonLd(global)} />
        {/* 品牌头：随页面滚走，让下面的分类行吸顶 */}
        <header className="bg-brand">
          <div className="mx-auto flex max-w-screen items-center gap-3 px-4 py-2.5 lg:max-w-5xl">
            <Link href="/" className="shrink-0" aria-label={siteName}>
              <Logo name={siteName} variant="white" />
            </Link>
            {/* 搜索改为图标按钮 → 跳转独立搜索页（不在头部内联输入框） */}
            <Link
              href="/search"
              aria-label="搜索"
              className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/15 text-white transition hover:bg-white/25"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4-4" strokeLinecap="round" />
              </svg>
            </Link>
          </div>
        </header>
        {/* 分类行：吸顶（sticky top-0）*/}
        <ChannelNav channels={channels} />
        <main className="mx-auto w-full max-w-screen px-2 py-3 lg:max-w-5xl">{children}</main>
        <SiteFooter global={global} />
        <Analytics metricaId={global?.yandexMetricaId} gaId={process.env.NEXT_PUBLIC_GA_ID} />
      </body>
    </html>
  );
}
