import { getTagSitemapEntries } from '@/lib/strapi';
import { SITE_URL } from '@/lib/env';
import { xmlResponse, xmlUrlset } from '@/lib/sitemap';

export const revalidate = 300;

/** 子 sitemap：标签页（≥3 篇已发布文章的）。lastmod = 该标签下最新文章 updatedAt。 */
export async function GET(): Promise<Response> {
  const entries = await getTagSitemapEntries();
  return xmlResponse(
    xmlUrlset(
      entries.map(({ slug, lastmod }) => ({
        loc: `${SITE_URL}/tag/${slug}`,
        lastmod,
        changefreq: 'daily' as const,
        priority: 0.4,
      })),
    ),
  );
}
