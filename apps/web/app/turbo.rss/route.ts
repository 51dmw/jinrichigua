import { getRecentArticlesWithContent, getGlobal, mediaUrl } from '@/lib/strapi';
import { SITE_URL } from '@/lib/env';

/**
 * Yandex Turbo Pages RSS（§4 MAY：移动极速页）。
 * 在 Yandex Webmaster 里把本地址作为 Turbo feed 提交即可。
 */
export const revalidate = 300;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 极简：把富文本按行转成段落（与文章页一致的最小处理）
function toTurboHtml(content: string): string {
  return content
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => `<p>${esc(l.replace(/^#+\s*/, ''))}</p>`)
    .join('');
}

export async function GET(): Promise<Response> {
  const [articles, global] = await Promise.all([
    getRecentArticlesWithContent(30),
    getGlobal(),
  ]);
  const siteName = global?.siteName ?? 'News Portal';

  const items = articles
    .map((a) => {
      const url = `${SITE_URL}/${a.channel!.slug}/${a.slug}`;
      const cover = mediaUrl(a.cover);
      const header = `<header><h1>${esc(a.title)}</h1>${
        cover ? `<figure><img src="${esc(cover)}"/></figure>` : ''
      }</header>`;
      const body = toTurboHtml(a.content ?? a.summary ?? '');
      const pub = new Date(a.publishAt ?? a.publishedAt ?? a.createdAt).toUTCString();
      return `  <item turbo="true">
    <link>${esc(url)}</link>
    <pubDate>${pub}</pubDate>
    <author>${esc(a.author ?? siteName)}</author>
    <turbo:content><![CDATA[${header}${body}]]></turbo:content>
  </item>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:yandex="http://news.yandex.ru" xmlns:media="http://search.yahoo.com/mrss/" xmlns:turbo="http://turbo.yandex.ru" version="2.0">
<channel>
  <title>${esc(siteName)}</title>
  <link>${esc(SITE_URL)}</link>
  <description>${esc(siteName)} Turbo feed</description>
  <language>zh</language>
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
