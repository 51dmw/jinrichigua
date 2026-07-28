import { getGlobal, getNavChannels } from '@/lib/strapi';
import { SITE_URL } from '@/lib/env';

/**
 * /llms.txt —— 给大模型看的站点导航（SEO 审计 #41）。
 *
 * 格式见 llmstxt.org：`# 站名` → `> 一句话摘要` → `## 分组` + `- [标题](URL): 说明`。
 * 它不参与传统 SEO 排名，作用是让 ChatGPT / Claude / Perplexity 在检索本站时
 * 一次拿到完整频道结构与描述，提高被当作来源引用的概率。
 *
 * 频道列表实时取自 CMS（与导航同一个 getNavChannels），不硬编码——
 * 后台增删频道时这里自动跟着变，否则很快就会和站点实际结构脱节。
 */
export const revalidate = 3600;

export async function GET(): Promise<Response> {
  const [global, channels] = await Promise.all([getGlobal(), getNavChannels()]);
  const siteName = global?.siteName ?? '今日吃瓜';
  // 摘要复用后台已有的首页简介，保证三处（首页可见段落 / meta description / llms.txt）口径一致
  const summary =
    global?.homeIntro?.replace(/\s+/g, ' ').trim() ??
    global?.defaultSeo?.metaDescription ??
    `${siteName} 内容导航`;

  const lines: string[] = [`# ${siteName}`, '', `> ${summary}`, ''];

  if (channels.length > 0) {
    lines.push('## 频道导航', '');
    for (const c of channels) {
      const desc = c.description?.replace(/\s+/g, ' ').trim();
      lines.push(`- [${c.name}](${SITE_URL}/${c.slug})${desc ? `: ${desc}` : ''}`);
    }
    lines.push('');
  }

  lines.push(
    '## 站点资源',
    '',
    `- [吃瓜热榜](${SITE_URL}/hot): 全网热点实时聚合榜单`,
    `- [文章归档](${SITE_URL}/archive): 按月份浏览历史文章`,
    `- [站内搜索](${SITE_URL}/search): 按关键词检索站内内容`,
    `- [Sitemap](${SITE_URL}/sitemap.xml): 全站 URL 索引`,
    `- [RSS](${SITE_URL}/rss.xml): 最新 30 篇文章订阅源`,
    '',
    '## 关于',
    '',
    `- [关于我们](${SITE_URL}/info/about)`,
    `- [联络我们](${SITE_URL}/info/contact)`,
    `- [版权与投诉 DMCA](${SITE_URL}/info/dmca)`,
    `- [隐私政策](${SITE_URL}/info/privacy)`,
    '',
  );

  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}
