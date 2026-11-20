import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/env';

/**
 * AI 训练类爬虫（抓内容去训练模型，不给站点带来搜索曝光）。
 * 依据各家官方爬虫说明归类；新增前先确认它是「训练」而不是「搜索/问答」用途。
 */
const AI_TRAINING_BOTS = [
  'GPTBot', // OpenAI 训练（搜索用的是 OAI-SearchBot，不在此列）
  'ClaudeBot', // Anthropic 训练（搜索用的是 Claude-SearchBot）
  'anthropic-ai',
  'Google-Extended', // Gemini 训练令牌
  'Applebot-Extended', // Apple 训练令牌
  'CCBot', // Common Crawl，训练语料主要来源
  'meta-externalagent', // Meta AI 训练
  'FacebookBot',
  'Amazonbot',
  'cohere-ai',
  'cohere-training-data-crawler',
  'Diffbot',
  'omgili',
  'omgilibot',
  'Webzio-Extended',
  'ImagesiftBot',
  'AI2Bot',
  'Timpibot',
  'PanguBot',
  'img2dataset',
];

// /robots.txt —— 引用两份 sitemap（§4 MUST）。
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // 站内搜索结果不收录（§4 避免重复/低质页）；广告展位演示同理（全是占位素材）
        disallow: ['/api/', '/search', '/ads-preview', '/ads/'],
      },
      // 有害/激进爬虫全屏蔽：Bytespider 吃带宽，MJ12bot/DotBot 纯外链采集，对本站 SEO 无贡献。
      {
        userAgent: ['Bytespider', 'MJ12bot', 'DotBot'],
        disallow: '/',
      },
      // AI 训练类爬虫全屏蔽；AI 搜索/问答类（OAI-SearchBot、ChatGPT-User、Claude-SearchBot、
      // Claude-User、PerplexityBot、ExaSearchBot 等）不在此列，走上面的通用规则照常抓取（GEO）。
      // Google-Extended / Applebot-Extended 只是 robots 令牌：禁的是拿内容训练模型，
      // 不影响 Googlebot / Applebot 正常收录。
      // 同一份名单在 Cloudflare WAF 自定义规则 `block-ai-training-bots` 里强制执行（403），改这里要同步那边。
      {
        userAgent: AI_TRAINING_BOTS,
        disallow: '/',
      },
    ],
    sitemap: [`${SITE_URL}/sitemap.xml`, `${SITE_URL}/news-sitemap.xml`],
    host: SITE_URL,
  };
}
