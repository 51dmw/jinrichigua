import { getAllAuthorSlugs } from '@/lib/strapi';
import { SITE_URL } from '@/lib/env';
import { xmlResponse, xmlUrlset } from '@/lib/sitemap';

export const revalidate = 300;

/** 子 sitemap：作者页（有文章的）。 */
export async function GET(): Promise<Response> {
  const slugs = await getAllAuthorSlugs();
  return xmlResponse(
    xmlUrlset(
      slugs.map((slug) => ({
        loc: `${SITE_URL}/author/${slug}`,
        changefreq: 'daily' as const,
        priority: 0.5,
      })),
    ),
  );
}
