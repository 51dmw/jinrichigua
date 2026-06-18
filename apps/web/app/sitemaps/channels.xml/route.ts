import { getAllChannelSlugs } from '@/lib/strapi';
import { SITE_URL } from '@/lib/env';
import { UrlEntry, xmlResponse, xmlUrlset } from '@/lib/sitemap';

export const revalidate = 300;

/** 子 sitemap：首页 + 热榜 + 频道页（有文章的）。 */
export async function GET(): Promise<Response> {
  const channelSlugs = await getAllChannelSlugs();
  const entries: UrlEntry[] = [
    { loc: SITE_URL, changefreq: 'hourly', priority: 1 },
    { loc: `${SITE_URL}/hot`, changefreq: 'hourly', priority: 0.7 },
    ...channelSlugs.map((slug) => ({
      loc: `${SITE_URL}/${slug}`,
      changefreq: 'hourly' as const,
      priority: 0.8,
    })),
  ];
  return xmlResponse(xmlUrlset(entries));
}
