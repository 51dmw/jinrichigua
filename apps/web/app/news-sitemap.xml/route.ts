import { getAllArticlesForSitemap, getGlobal } from '@/lib/strapi';
import { SITE_URL } from '@/lib/env';

export const revalidate = 300;

/**
 * /news-sitemap.xml —— Google News 图谱（§4 MUST）。
 * 按规范仅收录最近 48 小时内发布的文章；含 publication_date / title / name / language。
 * Next 原生 sitemap.ts 不支持 news 扩展命名空间，故用自定义 Route Handler 输出 XML。
 */

const TWO_DAYS_MS = 48 * 60 * 60 * 1000;

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function GET(): Promise<Response> {
  const [articles, global] = await Promise.all([getAllArticlesForSitemap(), getGlobal()]);
  const siteName = global?.siteName ?? 'News Portal';
  const now = Date.now();

  const recent = articles.filter((a) => {
    const t = new Date(a.publishAt ?? a.updatedAt ?? 0).getTime();
    return Number.isFinite(t) && now - t <= TWO_DAYS_MS;
  });

  const urls = recent
    .map((a) => {
      const loc = `${SITE_URL}/${a.channelSlug}/${a.slug}`;
      const pubDate = new Date(a.publishAt ?? a.updatedAt ?? now).toISOString();
      return `  <url>
    <loc>${esc(loc)}</loc>
    <news:news>
      <news:publication>
        <news:name>${esc(siteName)}</news:name>
        <news:language>zh-cn</news:language>
      </news:publication>
      <news:publication_date>${pubDate}</news:publication_date>
      <news:title>${esc(a.title)}</news:title>
    </news:news>
  </url>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${urls}
</urlset>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=600',
    },
  });
}
