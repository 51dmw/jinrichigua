import { getAllChannelSlugs, getSitemapLastmods } from '@/lib/strapi';
import { SITE_URL } from '@/lib/env';
import { UrlEntry, xmlResponse, xmlUrlset } from '@/lib/sitemap';

export const revalidate = 300;

/** 子 sitemap：首页 + 热榜 + 频道页（有文章的）。lastmod = 其下最新文章 updatedAt。 */
export async function GET(): Promise<Response> {
  const [channelSlugs, lm] = await Promise.all([getAllChannelSlugs(), getSitemapLastmods()]);
  const entries: UrlEntry[] = [
    { loc: SITE_URL, lastmod: lm.site, changefreq: 'hourly', priority: 1 },
    { loc: `${SITE_URL}/hot`, lastmod: lm.site, changefreq: 'hourly', priority: 0.7 },
    ...channelSlugs.map((slug) => ({
      loc: `${SITE_URL}/${slug}`,
      lastmod: lm.byChannel[slug],
      changefreq: 'hourly' as const,
      priority: 0.8,
    })),
  ];
  return xmlResponse(xmlUrlset(entries));
}
