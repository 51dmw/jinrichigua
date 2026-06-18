import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag, revalidatePath } from 'next/cache';
import { REVALIDATE_TOKEN, SITE_URL } from '@/lib/env';
import { submitToIndexNow } from '@/lib/indexnow';

/**
 * 按需 ISR 接口（§5 MUST：受 token 保护，供 Strapi lifecycle webhook 调用）。
 *
 * 鉴权：Authorization: Bearer <REVALIDATE_TOKEN>（与 Strapi 的 WEB_REVALIDATE_TOKEN 一致）。
 * Body: { type: 'article'|'channel'|'global', channelSlug?, articleSlug?, tag?, path? }
 */
export async function POST(req: NextRequest) {
  if (!REVALIDATE_TOKEN) {
    return NextResponse.json({ ok: false, error: 'REVALIDATE_TOKEN 未配置' }, { status: 500 });
  }

  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token !== REVALIDATE_TOKEN) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  let body: {
    type?: string;
    channelSlug?: string;
    articleSlug?: string;
    tag?: string;
    path?: string;
  };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const revalidated: string[] = [];

  // 显式 path / tag 优先
  if (body.path) {
    revalidatePath(body.path);
    revalidated.push(`path:${body.path}`);
  }
  if (body.tag) {
    revalidateTag(body.tag);
    revalidated.push(`tag:${body.tag}`);
  }

  // 内容粒度的标签失效（与 lib/strapi.ts 的 fetch tags 对齐）
  if (body.channelSlug && body.articleSlug) {
    revalidateTag(`article:${body.channelSlug}/${body.articleSlug}`);
    revalidatePath(`/${body.channelSlug}/${body.articleSlug}`);
    revalidated.push(`article:${body.channelSlug}/${body.articleSlug}`);
  }
  if (body.channelSlug) {
    revalidateTag(`channel:${body.channelSlug}`);
    revalidatePath(`/${body.channelSlug}`);
  }

  // 列表/首页/全局始终刷新
  revalidateTag('articles');
  revalidateTag('channels');
  if (body.type === 'global') revalidateTag('global');
  revalidatePath('/');
  revalidatePath('/sitemap.xml');
  revalidatePath('/news-sitemap.xml');

  // IndexNow 推送（§4）：把受影响的文章/频道 URL 即时提交给 Yandex + Bing。
  let indexNow: { ok: boolean; reason?: string } | undefined;
  const urls: string[] = [];
  if (body.channelSlug && body.articleSlug) {
    urls.push(`${SITE_URL}/${body.channelSlug}/${body.articleSlug}`);
  }
  if (body.channelSlug) urls.push(`${SITE_URL}/${body.channelSlug}`);
  if (urls.length > 0) {
    indexNow = await submitToIndexNow(urls);
  }

  return NextResponse.json({ ok: true, revalidated, indexNow, now: new Date().toISOString() });
}

// 健康检查
export async function GET() {
  return NextResponse.json({ ok: true, hint: 'POST with Bearer token to revalidate' });
}
