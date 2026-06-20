import { getAllTagSlugs, getSitemapLastmods } from '@/lib/strapi';
import { SITE_URL } from '@/lib/env';
import { xmlResponse, xmlUrlset } from '@/lib/sitemap';

export const revalidate = 300;

/** 子 sitemap：标签页（有文章的）。lastmod = 该标签下最新文章 updatedAt。 */
export async function GET(): Promise<Response> {
  const [slugs, lm] = await Promise.all([getAllTagSlugs(), getSitemapLastmods()]);
  return xmlResponse(
    xmlUrlset(
      slugs.map((slug) => ({
        loc: `${SITE_URL}/tag/${slug}`,
        lastmod: lm.byTag[slug],
        changefreq: 'daily' as const,
        priority: 0.4,
      })),
    ),
  );
}
