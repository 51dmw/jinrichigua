import { NextRequest, NextResponse } from 'next/server';
import { REVALIDATE_TOKEN, SITE_URL } from '@/lib/env';
import { submitToIndexNow } from '@/lib/indexnow';
import { getArticlesForSitemap } from '@/lib/strapi';

/**
 * IndexNow 批量提交接口（受 token 保护，与 /api/revalidate 同一个 REVALIDATE_TOKEN）。
 *
 * 两个用途：
 *   1) CMS 每 5 分钟的兜底扫描 —— POST { paths: ['/star/xxx', ...] }
 *      补上「lifecycle 即时推送」因前台重启 / 网络抖动 / IndexNow 返回非 2xx 丢掉的那些。
 *   2) 历史回补 —— POST { sinceDays: 3650, force: true }
 *      按 sitemap 的同一数据源枚举已发布文章，整站补提交一次。
 *
 * 日常推送不要带 force：去重窗口（见 lib/indexnow.ts）会把重复提交收敛掉。
 */

/** 单次回补的硬上限，防止误传 sinceDays 把整站几万条一次性推出去。 */
const MAX_BACKFILL = 20_000;
const PAGE_SIZE = 500;
/** 翻页硬上限，配合 MAX_BACKFILL 防止死循环。 */
const MAX_PAGES = 100;

interface Body {
  paths?: string[];
  urls?: string[];
  sinceDays?: number;
  force?: boolean;
}

/** 按 sitemap 的数据源枚举已发布文章 URL，只取 publishAt 在 cutoff 之后的。 */
async function collectArticleUrls(sinceDays: number): Promise<string[]> {
  const cutoff = Date.now() - sinceDays * 86_400_000;
  const urls: string[] = [];
  // 停止条件只看「这一页一条都没有」——getArticlesForSitemap 会滤掉没有频道的文章，
  // 拿 batch.length < PAGE_SIZE 当结束标志会在中间某页被滤剩几条时提前截断。
  for (let page = 1; page <= MAX_PAGES && urls.length < MAX_BACKFILL; page += 1) {
    const batch = await getArticlesForSitemap(page, PAGE_SIZE);
    if (batch.length === 0) break;
    for (const a of batch) {
      const ts = Date.parse(a.publishAt ?? a.updatedAt ?? '');
      // 时间解析不出来的按「要推」处理，宁可多推不可漏推
      if (Number.isNaN(ts) || ts >= cutoff) {
        urls.push(`${SITE_URL}/${a.channelSlug}/${a.slug}`);
      }
    }
  }
  return urls.slice(0, MAX_BACKFILL);
}

export async function POST(req: NextRequest) {
  if (!REVALIDATE_TOKEN) {
    return NextResponse.json({ ok: false, error: 'REVALIDATE_TOKEN 未配置' }, { status: 500 });
  }
  const auth = req.headers.get('authorization') ?? '';
  if ((auth.startsWith('Bearer ') ? auth.slice(7) : '') !== REVALIDATE_TOKEN) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const urls = [...(body.urls ?? []), ...(body.paths ?? [])];
  if (typeof body.sinceDays === 'number' && body.sinceDays > 0) {
    urls.push(...(await collectArticleUrls(body.sinceDays)));
  }
  if (urls.length === 0) {
    return NextResponse.json({ ok: false, error: '没有可提交的 URL' }, { status: 400 });
  }

  const result = await submitToIndexNow(urls, { force: body.force === true });
  console.log(
    `[indexnow] batch requested=${urls.length} submitted=${result.submitted} ` +
      `skipped=${result.skipped} ok=${result.ok} (${result.reason})`,
  );
  return NextResponse.json({ ...result, requested: urls.length, now: new Date().toISOString() });
}

export async function GET() {
  return NextResponse.json({ ok: true, hint: 'POST { paths | urls | sinceDays } with Bearer token' });
}
