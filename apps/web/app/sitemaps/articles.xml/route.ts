import { NextRequest } from 'next/server';
import { getArticlesForSitemap } from '@/lib/strapi';
import { SITE_URL } from '@/lib/env';
import { SHARD_SIZE, xmlResponse, xmlUrlset } from '@/lib/sitemap';

export const revalidate = 300;

/** 子 sitemap：文章页（按 ?page 分片，每片 SHARD_SIZE 条）。 */
export async function GET(req: NextRequest): Promise<Response> {
  const page = Math.max(1, Number(req.nextUrl.searchParams.get('page')) || 1);
  const articles = await getArticlesForSitemap(page, SHARD_SIZE);
  return xmlResponse(
    xmlUrlset(
      articles.map((a) => ({
        loc: `${SITE_URL}/${a.channelSlug}/${a.slug}`,
        lastmod: a.updatedAt ?? a.publishAt ?? undefined,
        changefreq: 'daily' as const,
        priority: 0.6,
      })),
    ),
  );
}
