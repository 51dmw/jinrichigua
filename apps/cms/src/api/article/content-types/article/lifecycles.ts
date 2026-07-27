/**
 * 文章 lifecycle。
 *
 * 写入前（§6 内容安全）：敏感词过滤——扫描 标题+正文，命中即拦截（抛错）。
 * 写入后（§7 发布联动）：best-effort 调用前台按需 ISR 接口。失败只告警、不阻塞。
 *
 * M4/M5 在 afterX 内补：② IndexNow 推送 ③ sitemap 缓存刷新。
 */
import { errors } from '@strapi/utils';

type AnyResult = { slug?: string; channel?: { slug?: string } } | null | undefined;

async function assertNoSensitiveWords(strapi: any, data: { title?: string; content?: string }) {
  if (!data) return;
  const parts = [data.title, data.content].filter(Boolean).join('\n');
  if (!parts) return;
  const hits: string[] = await strapi
    .service('api::sensitive-word.sensitive-word')
    .scan(parts);
  if (hits.length > 0) {
    throw new errors.ApplicationError(
      `命中敏感词，已拦截：${hits.join('、')}`,
      { hits },
    );
  }
}

async function pingRevalidate(strapi: any, result: AnyResult) {
  const url = process.env.WEB_REVALIDATE_URL;
  const token = process.env.WEB_REVALIDATE_TOKEN;
  if (!url || !token) return;

  const channelSlug = result?.channel?.slug;
  const articleSlug = result?.slug;

  try {
    // redirect:'manual' + 检查 res.ok：2026-07-27 踩过——域名迁移后本地址仍指向老域，
    // 老域 301 到新域时跨源重定向会丢掉 Authorization 头，前台返回 401；
    // 而原实现既不看状态码也不禁重定向，401 被当成成功，静默失效了四天。
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ type: 'article', channelSlug, articleSlug }),
      redirect: 'manual',
    });
    if (!res.ok) {
      strapi?.log?.warn(
        `[lifecycle] revalidate ping 未生效：HTTP ${res.status}（${url}）`
          + `${res.status >= 300 && res.status < 400 ? ' —— 该地址发生重定向，请把 WEB_REVALIDATE_URL 改成最终域名' : ''}`,
      );
    }
  } catch (err) {
    strapi?.log?.warn(`[lifecycle] revalidate ping failed: ${(err as Error).message}`);
  }

  // IndexNow（§4）在前台 /api/revalidate 内完成：收到本 ping 后即把受影响 URL
  // 提交给 Yandex + Bing（见 apps/web/lib/indexnow.ts）。CMS 侧无需直接调用。
}

export default {
  async beforeCreate(event: any) {
    const data = event.params?.data;
    // 默认发布时间 = 现在（无则补），保证「最新发布倒序」排序始终有效；
    // 需定时发布时编辑可在后台改成未来时间。
    if (data && !data.publishAt) data.publishAt = new Date().toISOString();
    await assertNoSensitiveWords(strapi, data);
  },
  async beforeUpdate(event: any) {
    await assertNoSensitiveWords(strapi, event.params.data);
  },
  async afterCreate(event: any) {
    await pingRevalidate(strapi, event.result);
  },
  async afterUpdate(event: any) {
    // PV 自增（仅 viewCount 变化）不触发发布联动，避免每次浏览都重生成/推送（§M6）。
    const data = event.params?.data ?? {};
    const keys = Object.keys(data);
    if (keys.length === 1 && keys[0] === 'viewCount') return;
    await pingRevalidate(strapi, event.result);
  },
  async afterDelete(event: any) {
    await pingRevalidate(strapi, event.result);
  },
};
