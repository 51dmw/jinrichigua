import { getAllTagSlugs } from '@/lib/strapi';
import { SITE_URL } from '@/lib/env';
import { xmlResponse, xmlUrlset } from '@/lib/sitemap';

export const revalidate = 300;

/** 子 sitemap：标签页（有文章的）。 */
export async function GET(): Promise<Response> {
  const slugs = await getAllTagSlugs();
  return xmlResponse(
    xmlUrlset(
      slugs.map((slug) => ({
        loc: `${SITE_URL}/tag/${slug}`,
        changefreq: 'daily' as const,
        priority: 0.4,
      })),
    ),
  );
}
