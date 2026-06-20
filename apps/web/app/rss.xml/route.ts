import { getRecentArticlesWithContent, getGlobal } from '@/lib/strapi';
import { SITE_URL, SITE_LOCALE } from '@/lib/env';

/**
 * 标准 RSS 2.0 订阅源（§4）。供 Feedly/Inoreader 等阅读器与聚合站订阅。
 * 与 /turbo.rss（Yandex Turbo 专用）区分：本源是通用 RSS。
 */
export const revalidate = 300;

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function GET(): Promise<Response> {
  const [articles, global] = await Promise.all([getRecentArticlesWithContent(30), getGlobal()]);
  const siteName = global?.siteName ?? 'News Portal';
  const desc = global?.defaultSeo?.metaDescription ?? `${siteName} 最新内容`;

  const withTs = articles
    .filter((a) => a.channel?.slug)
    .map((a) => ({
      a,
      ts: new Date(a.publishAt ?? a.publishedAt ?? a.createdAt),
    }));
  const lastBuild = (withTs[0]?.ts ?? new Date(0)).toUTCString();

  const items = withTs
    .map(({ a, ts }) => {
      const url = `${SITE_URL}/${a.channel!.slug}/${a.slug}`;
      return `  <item>
    <title>${esc(a.title)}</title>
    <link>${esc(url)}</link>
    <guid isPermaLink="true">${esc(url)}</guid>
    <pubDate>${ts.toUTCString()}</pubDate>
    <author>${esc(a.author ?? siteName)}</author>
    <description><![CDATA[${a.summary ?? ''}]]></description>
  </item>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${esc(siteName)}</title>
  <link>${esc(SITE_URL)}</link>
  <description>${esc(desc)}</description>
  <language>${esc(SITE_LOCALE)}</language>
  <lastBuildDate>${lastBuild}</lastBuildDate>
  <atom:link href="${esc(SITE_URL)}/rss.xml" rel="self" type="application/rss+xml"/>
${items}
</channel>
</rss>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=600',
    },
  });
}
