import { NextRequest, NextResponse } from 'next/server';
import { STRAPI_API_URL, STRAPI_API_TOKEN, SITE_URL, TURNSTILE_SECRET_KEY } from '@/lib/env';

export const dynamic = 'force-dynamic';

const authHeaders: Record<string, string> = STRAPI_API_TOKEN
  ? { Authorization: `Bearer ${STRAPI_API_TOKEN}` }
  : {};

// ── 防刷：按 IP 滑动窗口限流（内存版）──
// 注：Cloudflare Workers 多实例不共享内存，生产建议用 Workers KV / Durable Objects
// 或 Cloudflare 原生 Rate Limiting；此处为单实例/开发可用的演示实现（§1 限流）。
const RL_WINDOW_MS = 60_000;
const RL_MAX = 3;
const rlStore = new Map<string, number[]>();

function clientIp(req: NextRequest): string {
  return (
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const hits = (rlStore.get(ip) ?? []).filter((t) => now - t < RL_WINDOW_MS);
  if (hits.length >= RL_MAX) {
    rlStore.set(ip, hits);
    return true;
  }
  hits.push(now);
  rlStore.set(ip, hits);
  return false;
}

// ── 重复内容去重（同 IP 5 分钟内相同评论）──
const DEDUP_WINDOW_MS = 5 * 60_000;
const dedupStore = new Map<string, number>();
function isDuplicate(ip: string, content: string): boolean {
  const key = `${ip}::${content}`;
  const now = Date.now();
  const last = dedupStore.get(key);
  if (last && now - last < DEDUP_WINDOW_MS) return true;
  dedupStore.set(key, now);
  return false;
}

// ── Cloudflare Turnstile 人机验证（未配置 SECRET 则跳过，便于本地开发）──
async function turnstilePassed(token: string, ip: string): Promise<boolean> {
  if (!TURNSTILE_SECRET_KEY) return true; // 未启用
  if (!token) return false;
  try {
    const form = new URLSearchParams({ secret: TURNSTILE_SECRET_KEY, response: token });
    if (ip && ip !== 'unknown') form.set('remoteip', ip);
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
      cache: 'no-store',
    });
    const json = (await res.json()) as { success?: boolean };
    return json.success === true;
  } catch {
    return false; // 验证服务不可达时从严
  }
}

// ── 来源校验：跨站提交 / 空 UA 直接拒（挡掉嵌入式滥用与裸脚本）──
function originSuspicious(req: NextRequest): boolean {
  const ua = req.headers.get('user-agent') ?? '';
  if (!ua.trim()) return true; // 浏览器一定有 UA
  const ref = req.headers.get('origin') || req.headers.get('referer');
  if (ref) {
    try {
      if (new URL(ref).host !== new URL(SITE_URL).host) return true; // 跨站
    } catch {
      return true;
    }
  }
  return false;
}

/** GET /api/comments?article={documentId} —— 仅返回已审核评论。 */
export async function GET(req: NextRequest) {
  const articleId = req.nextUrl.searchParams.get('article') ?? '';
  if (!articleId) return NextResponse.json({ comments: [] });

  const qs =
    `filters[article][documentId][$eq]=${encodeURIComponent(articleId)}` +
    `&filters[approved][$eq]=true&sort=createdAt:desc` +
    `&fields[0]=content&fields[1]=authorName&fields[2]=createdAt&pagination[pageSize]=100`;

  try {
    const res = await fetch(`${STRAPI_API_URL}/api/comments?${qs}`, {
      headers: authHeaders,
      cache: 'no-store',
    });
    const json = await res.json();
    const comments = (json.data ?? []).map((c: any) => ({
      id: c.documentId,
      content: c.content,
      authorName: c.authorName,
      createdAt: c.createdAt,
    }));
    return NextResponse.json({ comments });
  } catch {
    return NextResponse.json({ comments: [] }, { status: 502 });
  }
}

/** POST /api/comments —— 提交评论（Strapi lifecycle 强制待审 + 敏感词过滤）。 */
export async function POST(req: NextRequest) {
  let body: {
    articleId?: string;
    content?: string;
    authorName?: string;
    website?: string;
    turnstileToken?: string;
  };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  // 蜜罐：隐藏字段被填 = 机器人，静默丢弃（假装成功，不提示，避免被探测）
  if ((body.website ?? '').trim()) {
    return NextResponse.json({ ok: true, message: '评论已提交，审核通过后显示' });
  }

  // 来源校验：跨站提交 / 空 UA（裸脚本）—— 同样静默丢弃，不给探测反馈
  if (originSuspicious(req)) {
    return NextResponse.json({ ok: true, message: '评论已提交，审核通过后显示' });
  }

  const content = (body.content ?? '').trim();
  const articleId = (body.articleId ?? '').trim();
  if (!articleId || !content) {
    return NextResponse.json({ ok: false, error: '内容不能为空' }, { status: 400 });
  }
  if (content.length > 1000) {
    return NextResponse.json({ ok: false, error: '评论过长' }, { status: 400 });
  }

  const ip = clientIp(req);

  // 人机验证（Turnstile）—— 未配置则自动放行
  if (!(await turnstilePassed((body.turnstileToken ?? '').trim(), ip))) {
    return NextResponse.json(
      { ok: false, error: '人机验证失败，请重试' },
      { status: 403 },
    );
  }

  // 防刷限流（按 IP）
  if (rateLimited(ip)) {
    return NextResponse.json(
      { ok: false, error: '评论太频繁，请稍后再试' },
      { status: 429 },
    );
  }

  // 重复内容（同 IP 5 分钟内相同评论）
  if (isDuplicate(ip, content)) {
    return NextResponse.json(
      { ok: false, error: '请勿重复发表相同评论' },
      { status: 409 },
    );
  }

  try {
    const res = await fetch(`${STRAPI_API_URL}/api/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      cache: 'no-store',
      body: JSON.stringify({
        data: {
          content,
          authorName: (body.authorName ?? '').trim().slice(0, 50) || '匿名',
          article: articleId,
        },
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = err?.error?.message ?? '提交失败';
      return NextResponse.json({ ok: false, error: msg }, { status: res.status === 400 ? 400 : 502 });
    }
    return NextResponse.json({ ok: true, message: '评论已提交，审核通过后显示' });
  } catch {
    return NextResponse.json({ ok: false, error: '提交失败' }, { status: 502 });
  }
}
