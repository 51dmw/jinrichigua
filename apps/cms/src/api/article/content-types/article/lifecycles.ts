/**
 * 文章 lifecycle。
 *
 * 写入前（§6 内容安全）：敏感词过滤——扫描 标题+正文，命中即拦截（抛错）。
 * 写入后（§7 发布联动）：best-effort 调用前台按需 ISR 接口，前台收到后同步推 IndexNow。
 *   失败只告警、不阻塞；漏掉的由 config/server.ts 里每 5 分钟的兜底扫描补推。
 */
import { errors } from '@strapi/utils';

const ARTICLE_UID = 'api::article.article';

type AnyResult =
  | {
      id?: number;
      documentId?: string;
      slug?: string;
      publishedAt?: string | null;
      channel?: { slug?: string };
    }
  | null
  | undefined;

interface ArticleRef {
  channelSlug?: string;
  articleSlug?: string;
  published: boolean;
}

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

/**
 * 从 lifecycle 结果解析出「频道 slug + 文章 slug + 是否已发布」。
 *
 * 关键：**不能**直接用 `event.result.channel.slug`。Strapi 5 的 db lifecycle 结果里不含关联字段
 * （@strapi/core 5.7.0：documents.publish → entries.publish → createEntry → db.query().create()，
 * 传下去的 query 只有 fields，没有 populate）。2026-08-10 排查发现：因为这里一直取不到频道，
 * 前台 /api/revalidate 从没收到过 channelSlug，文章 URL 一篇都没提交过 IndexNow，
 * 每篇文章的按需 ISR（revalidatePath('/频道/别名')）也从没执行过。
 * 所以取不到就自己再查一次，多一次查询换「不漏推」。
 */
async function resolveArticleRef(strapi: any, result: AnyResult): Promise<ArticleRef> {
  const published = result?.publishedAt != null;
  const ref: ArticleRef = {
    channelSlug: result?.channel?.slug,
    articleSlug: result?.slug,
    published,
  };
  if (ref.channelSlug || !result?.documentId) return ref;

  const doc = await strapi
    .documents(ARTICLE_UID)
    .findOne({
      documentId: result.documentId,
      status: published ? 'published' : 'draft',
      fields: ['slug'],
      populate: { channel: { fields: ['slug'] } },
    })
    .catch(() => null);
  ref.channelSlug = doc?.channel?.slug;
  ref.articleSlug = ref.articleSlug ?? doc?.slug;
  return ref;
}

async function pingRevalidate(strapi: any, ref: ArticleRef) {
  const url = process.env.WEB_REVALIDATE_URL;
  const token = process.env.WEB_REVALIDATE_TOKEN;
  if (!url || !token) return;

  try {
    // redirect:'manual' + 检查 res.ok：2026-07-27 踩过——域名迁移后本地址仍指向老域，
    // 老域 301 到新域时跨源重定向会丢掉 Authorization 头，前台返回 401；
    // 而原实现既不看状态码也不禁重定向，401 被当成成功，静默失效了四天。
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        type: 'article',
        channelSlug: ref.channelSlug,
        articleSlug: ref.articleSlug,
        // 草稿改动不推 IndexNow（URL 还没上线），但缓存该失效照样失效
        published: ref.published,
      }),
      redirect: 'manual',
    });
    if (!res.ok) {
      strapi?.log?.warn(
        `[lifecycle] revalidate ping 未生效：HTTP ${res.status}（${url}）`
          + `${res.status >= 300 && res.status < 400 ? ' —— 该地址发生重定向，请把 WEB_REVALIDATE_URL 改成最终域名' : ''}`,
      );
    } else if (ref.published && !ref.channelSlug) {
      // 能推但没带上频道 → 前台只能刷首页，文章 URL 会漏。留痕给兜底扫描背书。
      strapi?.log?.warn(
        `[lifecycle] 文章 ${ref.articleSlug ?? '?'} 解析不到频道 slug，本次未即时提交文章 URL，等兜底扫描补`,
      );
    }
  } catch (err) {
    strapi?.log?.warn(`[lifecycle] revalidate ping failed: ${(err as Error).message}`);
  }

  // IndexNow（§4）在前台 /api/revalidate 内完成：收到本 ping 后即把受影响 URL
  // 提交给 Yandex + Bing（见 apps/web/lib/indexnow.ts）。CMS 侧无需直接调用。
}

async function pingFromResult(strapi: any, result: AnyResult) {
  try {
    await pingRevalidate(strapi, await resolveArticleRef(strapi, result));
  } catch (err) {
    strapi?.log?.warn(`[lifecycle] revalidate skipped: ${(err as Error).message}`);
  }
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
  async beforeDelete(event: any) {
    // 行删掉之后就查不到频道了，先把 URL 素材存进 event.state（before/after 之间共享，
    // 见 @strapi/database 的 lifecycles.run：states 按订阅者透传）。
    try {
      const row = await strapi.db
        .query(ARTICLE_UID)
        .findOne({ where: event.params?.where, populate: { channel: true } });
      if (row) {
        event.state.article = {
          channelSlug: row.channel?.slug,
          articleSlug: row.slug,
          published: row.publishedAt != null,
        } satisfies ArticleRef;
      }
    } catch {
      /* 查不到就退回 afterDelete 里的常规解析 */
    }
  },
  async afterCreate(event: any) {
    // 注意：发布动作在库层就是「新建一行 published 版本」，所以文章发布走的是这里。
    await pingFromResult(strapi, event.result);
  },
  async afterUpdate(event: any) {
    // PV 自增（仅 viewCount 变化）不触发发布联动，避免每次浏览都重生成/推送（§M6）。
    const data = event.params?.data ?? {};
    const keys = Object.keys(data);
    if (keys.length === 1 && keys[0] === 'viewCount') return;
    await pingFromResult(strapi, event.result);
  },
  async afterDelete(event: any) {
    const cached: ArticleRef | undefined = event.state?.article;
    if (cached) {
      // 删除/下架仍然 ping：列表页、频道页、首页的缓存都要跟着失效。
      // 至于那条已经消失的文章 URL——前台提交前会探测存活，404 会被自动过滤掉，
      // 不会推给 IndexNow（见 apps/web/lib/indexnow.ts 的 filterAlive）。
      await pingRevalidate(strapi, cached).catch(() => undefined);
      return;
    }
    await pingFromResult(strapi, event.result);
  },
};
