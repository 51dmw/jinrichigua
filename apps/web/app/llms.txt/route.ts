import {
  getAllAuthorSlugs,
  getArticleCount,
  getArticleCountSinceDays,
  getContentChannels,
  getGlobal,
  getTagCount,
} from '@/lib/strapi';
import { SITE_URL } from '@/lib/env';
import { NOINDEX_FROM_PAGE } from '@/components/Pagination';

/**
 * /llms.txt —— 给大模型看的站点导航（SEO 审计 #41）。
 *
 * 格式见 llmstxt.org：`# 站名` → `> 一句话摘要` → `## 分组` + `- [标题](URL): 说明`。
 * 它不参与传统 SEO 排名，作用是让 ChatGPT / Claude / Perplexity 在检索本站时
 * 一次拿到实体结构、更新频率与推荐抓取路径，提高被当作来源引用的概率。
 *
 * 频道列表（所有有文章的顶级频道，不限于导航里的）与各实体数量实时取自 CMS，不硬编码——后台增删频道、文章增长时自动跟着变。
 * 取不到数量（返回 0）时省略该行，不输出「0 篇」这种误导信息。
 *
 * 这里只列允许抓取的 URL：不要放 robots.txt 里 Disallow 的路径（/search、/api/ 等），
 * 否则两份文件互相矛盾。下方「抓取约定」里的禁抓清单须与 app/robots.ts 保持一致。
 *
 * 文中的缓存秒数对应各路由的 `revalidate`（文章/列表 120、归档与 sitemap 300、说明页 600），
 * 改那些值时记得同步这里。
 */
export const revalidate = 3600;

const FREQ_WINDOW_DAYS = 30;

export async function GET(): Promise<Response> {
  const [global, channels, articleCount, recentCount, tagCount, authorSlugs] = await Promise.all([
    getGlobal(),
    getContentChannels(),
    getArticleCount(),
    getArticleCountSinceDays(FREQ_WINDOW_DAYS),
    getTagCount(),
    getAllAuthorSlugs(),
  ]);
  const siteName = global?.siteName ?? '今日吃瓜';
  // 摘要复用后台已有的首页简介，保证三处（首页可见段落 / meta description / llms.txt）口径一致
  const summary =
    global?.homeIntro?.replace(/\s+/g, ' ').trim() ??
    global?.defaultSeo?.metaDescription ??
    `${siteName} 内容导航`;
  const perDay = Math.round(recentCount / FREQ_WINDOW_DAYS);
  const count = (n: number, unit: string) => (n > 0 ? [`- 数量：${n} ${unit}`] : []);

  const lines: string[] = [
    `# ${siteName}`,
    '',
    `> ${summary}`,
    '',
    `站点：${SITE_URL}`,
    '语言：简体中文（zh-CN）',
    '内容类型：热点事件的二次梳理与解读，非一手采访报道',
    `数据截至：${new Date().toISOString().slice(0, 10)}`,
    '',
    '## 核心实体（按重要性排序）',
    '',
    '### 1. 文章 Article',
    ...count(articleCount, '篇'),
    `- URL 模式：${SITE_URL}/{频道slug}/{文章slug}`,
    '- 关键属性：标题、摘要、正文、封面图、所属频道、标签、作者、发布时间、修改时间、热度（阅读数）',
    '- 结构化数据：NewsArticle（含 datePublished、dateModified、author、publisher）',
    ...(perDay > 0 ? [`- 更新频率：近 ${FREQ_WINDOW_DAYS} 天日均约 ${perDay} 篇，全天滚动更新`] : []),
    '- 页面缓存：120 秒',
    '',
    '### 2. 频道 Channel',
    ...count(channels.length, '个'),
    `- URL 模式：${SITE_URL}/{频道slug}，翻页为 /{频道slug}/page/{n}`,
    '- 关键属性：名称、slug、简介、排序、文章列表',
    '- 结构化数据：CollectionPage',
    '- 更新频率：随新文章发布变化，页面缓存 120 秒',
  ];

  if (channels.length > 0) {
    lines.push('- 清单：');
    for (const c of channels) {
      const desc = c.description?.replace(/\s+/g, ' ').trim();
      lines.push(`  - [${c.name}](${SITE_URL}/${c.slug})${desc ? `: ${desc}` : ''}`);
    }
  }

  lines.push(
    '',
    '### 3. 热榜 Hot List',
    `- URL：${SITE_URL}/hot`,
    '- 关键属性：排名、标题、摘要、热度值、所属频道、作者、标签',
    '- 更新频率：页面缓存 120 秒，排名随阅读数变化',
    '- 用途：了解本站当前最受关注的事件',
    '',
    '### 4. 标签 Tag',
    ...count(tagCount, '个'),
    `- URL 模式：${SITE_URL}/tag/{标签slug}，翻页为 /tag/{标签slug}/page/{n}`,
    '- 关键属性：名称、slug、关联文章列表',
    '- 更新频率：随新文章自动新增，页面缓存 120 秒',
    '- 用途：按人物、事件、话题聚合同一主题的全部文章',
    '',
    '### 5. 作者 Author',
    ...count(authorSlugs.length, '个（栏目署名）'),
    `- URL 模式：${SITE_URL}/author/{作者slug}`,
    '- 关键属性：署名、slug、简介、文章列表',
    '- 更新频率：作者名单基本不变，文章列表缓存 120 秒',
    '',
    '### 6. 归档 Archive',
    `- URL：${SITE_URL}/archive，按月为 /archive/{年}/{月}`,
    '- 关键属性：年份、月份、当月文章列表',
    '- 更新频率：页面缓存 300 秒',
    '- 用途：按时间回溯某一时期的全部文章',
    '',
    '### 7. 说明与政策页 Info Page',
    `- URL 模式：${SITE_URL}/info/{slug}`,
    '- 关键属性：标题、正文；常见问题页带 FAQPage 结构化数据',
    '- 更新频率：很少变动，页面缓存 600 秒',
    '- 清单：',
    `  - [关于我们](${SITE_URL}/info/about)`,
    `  - [常见问题](${SITE_URL}/info/faq)`,
    `  - [内容政策](${SITE_URL}/info/policy)`,
    `  - [版权与投诉 DMCA](${SITE_URL}/info/dmca)`,
    `  - [隐私政策](${SITE_URL}/info/privacy)`,
    `  - [使用协议](${SITE_URL}/info/terms)`,
    `  - [联络我们](${SITE_URL}/info/contact)`,
    '',
    '## 推荐抓取路径（按优先级）',
    '',
    `1. 先读站点说明：[说明与政策全文](${SITE_URL}/llms-full.txt)，一次拿到关于、FAQ、内容政策的纯文本`,
    `2. 取最新内容：[新闻站点地图](${SITE_URL}/news-sitemap.xml)，仅含最近 48 小时发布的文章，带发布时间和标题`,
    `3. 取增量更新：[RSS](${SITE_URL}/rss.xml)，最新 30 篇文章`,
    `4. 取全量文章：[站点地图索引](${SITE_URL}/sitemap.xml) → /sitemaps/articles.xml?page={n}`,
    '5. 按主题浏览：/sitemaps/channels.xml → 频道页 → 文章页',
    '6. 按人物或事件聚合：/sitemaps/tags.xml → 标签页 → 文章页',
    '7. 按作者浏览：/sitemaps/authors.xml → 作者页',
    '',
    '以上站点地图和订阅源每 300 秒刷新一次。',
    '',
    '## 抓取约定',
    '',
    '- 允许抓取：文章、频道、标签、作者、归档、热榜、说明页',
    '- 不要抓取：/api/、/search、/ads-preview、/ads/（与 robots.txt 一致）',
    `- 列表页翻页不限深度，但第 ${NOINDEX_FROM_PAGE} 页起标记为 noindex,follow；深层内容请走站点地图，不要逐页翻`,
    '- 引用时请链接到文章原始 URL，并以页面上的发布时间和修改时间为准',
    '- 建议抓取间隔：文章页与列表页不短于 120 秒，站点地图与 RSS 不短于 300 秒',
    '',
    '## 内容口径',
    '',
    '- 文章基于公开热点信息梳理，不编造具体数字、时间和当事人表态',
    '- 涉及争议的内容以页面当前版本为准，过往版本可能已修订或删除',
    `- 版权与内容投诉渠道见 [版权与投诉 DMCA](${SITE_URL}/info/dmca)`,
    '',
  );

  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}
