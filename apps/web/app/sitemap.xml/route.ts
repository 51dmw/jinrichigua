import { getArticleCount } from '@/lib/strapi';
import { SITE_URL } from '@/lib/env';
import { SHARD_SIZE, xmlResponse, xmlSitemapIndex } from '@/lib/sitemap';

export const revalidate = 300;

/**
 * /sitemap.xml —— 顶层 sitemap index（分层）。引用各类型子 sitemap：
 *   频道 / 标签 / 作者 / 新闻图谱 / 文章（按 SHARD_SIZE 分片）。
 */
export async function GET(): Promise<Response> {
  const count = await getArticleCount();
  const shards = Math.max(1, Math.ceil(count / SHARD_SIZE));

  const sitemaps: { loc: string }[] = [
    { loc: `${SITE_URL}/sitemaps/channels.xml` },
    { loc: `${SITE_URL}/sitemaps/tags.xml` },
    { loc: `${SITE_URL}/sitemaps/authors.xml` },
    { loc: `${SITE_URL}/news-sitemap.xml` },
  ];
  for (let i = 1; i <= shards; i++) {
    sitemaps.push({ loc: `${SITE_URL}/sitemaps/articles.xml?page=${i}` });
  }

  return xmlResponse(xmlSitemapIndex(sitemaps));
}
