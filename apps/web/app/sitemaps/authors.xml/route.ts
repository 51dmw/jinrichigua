import { getAllAuthorSlugs, getSitemapLastmods } from '@/lib/strapi';
import { SITE_URL } from '@/lib/env';
import { xmlResponse, xmlUrlset } from '@/lib/sitemap';

export const revalidate = 300;

/** 子 sitemap：作者页（有文章的）。lastmod = 该作者最新文章 updatedAt。 */
export async function GET(): Promise<Response> {
  const [slugs, lm] = await Promise.all([getAllAuthorSlugs(), getSitemapLastmods()]);
  return xmlResponse(
    xmlUrlset(
      slugs.map((slug) => ({
        loc: `${SITE_URL}/author/${slug}`,
        lastmod: lm.byAuthor[slug],
        changefreq: 'daily' as const,
        priority: 0.5,
      })),
    ),
  );
}
