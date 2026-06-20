import { getArticleCount, getSitemapLastmods } from '@/lib/strapi';
import { SITE_URL } from '@/lib/env';
import { SHARD_SIZE, xmlResponse, xmlSitemapIndex } from '@/lib/sitemap';

export const revalidate = 300;

/**
 * /sitemap.xml —— 顶层 sitemap index（分层）。引用各类型子 sitemap：
 *   频道 / 标签 / 作者 / 新闻图谱 / 文章（按 SHARD_SIZE 分片）。
 *   lastmod 统一取全站最新文章 updatedAt（子 sitemap 内容随之变化）。
 */
export async function GET(): Promise<Response> {
  const [count, lm] = await Promise.all([getArticleCount(), getSitemapLastmods()]);
  const shards = Math.max(1, Math.ceil(count / SHARD_SIZE));

  const sitemaps: { loc: string; lastmod?: string }[] = [
    { loc: `${SITE_URL}/sitemaps/channels.xml`, lastmod: lm.site },
    { loc: `${SITE_URL}/sitemaps/tags.xml`, lastmod: lm.site },
    { loc: `${SITE_URL}/sitemaps/authors.xml`, lastmod: lm.site },
    { loc: `${SITE_URL}/news-sitemap.xml`, lastmod: lm.site },
  ];
  for (let i = 1; i <= shards; i++) {
    sitemaps.push({ loc: `${SITE_URL}/sitemaps/articles.xml?page=${i}`, lastmod: lm.site });
  }

  return xmlResponse(xmlSitemapIndex(sitemaps));
}
