import { getGlobal, getPageBySlug } from '@/lib/strapi';
import { SITE_URL } from '@/lib/env';

/**
 * /llms-full.txt —— llms.txt 的全文版：把说明类、政策类页面的正文合并成一份纯文本，
 * 让大模型一次读完「这个站是什么、怎么处理内容与投诉」，不必逐页抓取。
 *
 * 只放 /info/* 的说明与政策页，不放文章。正文实时取自 CMS；后台没有的页面直接跳过。
 * 每段标注来源 URL，便于引用回链。
 */
export const revalidate = 3600;

// 顺序即输出顺序。slug 与页脚（SiteFooter）里的 /info/* 链接保持一致。
const SLUGS = ['about', 'faq', 'policy', 'dmca', 'privacy', 'terms', 'contact'];

export async function GET(): Promise<Response> {
  const [global, pages] = await Promise.all([
    getGlobal(),
    Promise.all(SLUGS.map(async (slug) => ({ slug, page: await getPageBySlug(slug) }))),
  ]);
  const siteName = global?.siteName ?? '今日吃瓜';
  // 摘要与 llms.txt 同源，保证两份文件口径一致
  const summary =
    global?.homeIntro?.replace(/\s+/g, ' ').trim() ??
    global?.defaultSeo?.metaDescription ??
    `${siteName} 说明与政策全文`;

  const lines: string[] = [`# ${siteName}`, '', `> ${summary}`, ''];

  for (const { slug, page } of pages) {
    const body = (page?.body ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      // 正文里自带的 #/## 小标题统一降到三级，避免和本文件的 ## 分节混在一起
      .map((l) => l.replace(/^#+\s*/, '### '));
    if (!page || body.length === 0) continue;
    lines.push(`## ${page.title}`, '', `来源：${SITE_URL}/info/${slug}`, '', body.join('\n\n'), '');
  }

  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}
