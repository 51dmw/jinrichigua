'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      getResponse: (id?: string) => string | undefined;
    };
  }
}

const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/**
 * 文章评论（独立客户端渲染，§6 先审后发）。
 * - 任何人可评论（无需登录）；提交后进后台审核，通过才对外展示。
 * - 评论内容挂载后客户端拉取，**不进文章服务端 HTML**（SEO：不污染文章正文）。
 */
type CommentItem = {
  id: string;
  content: string;
  authorName?: string | null;
  createdAt: string;
  pending?: boolean;
};

const AVATAR_COLORS = [
  'bg-rose-500',
  'bg-orange-500',
  'bg-amber-500',
  'bg-emerald-500',
  'bg-sky-500',
  'bg-indigo-500',
  'bg-violet-500',
];

function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function fmt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function Avatar({ name }: { name: string }) {
  const n = name || '匿';
  return (
    <span
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-medium text-white ${avatarColor(n)}`}
      aria-hidden
    >
      {n.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function ArticleComments({
  articleId,
  turnstileSiteKey = '',
}: {
  articleId: string;
  turnstileSiteKey?: string;
}) {
  const [comments, setComments] = useState<CommentItem[] | null>(null);
  const [pending, setPending] = useState<CommentItem[]>([]); // 本地乐观展示（审核中）
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [hp, setHp] = useState(''); // 蜜罐：真人不会填，机器人会
  const [token, setToken] = useState(''); // Turnstile 人机验证令牌
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const tsRef = useRef<HTMLDivElement>(null);
  const tsWidgetId = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/comments?article=${encodeURIComponent(articleId)}`)
      .then((r) => r.json())
      .then((d) => alive && setComments(d.comments ?? []))
      .catch(() => alive && setComments([]));
    return () => {
      alive = false;
    };
  }, [articleId]);

  // Turnstile：按需注入脚本并显式渲染（未配置 siteKey 则完全不加载）
  useEffect(() => {
    if (!turnstileSiteKey) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const render = () => {
      if (!window.turnstile || !tsRef.current || tsWidgetId.current) return false;
      tsWidgetId.current = window.turnstile.render(tsRef.current, {
        sitekey: turnstileSiteKey,
        size: 'invisible', // 无感模式：后台静默验证，不渲染可见组件
        callback: (t: string) => setToken(t),
        'error-callback': () => setToken(''),
        'expired-callback': () => setToken(''),
        'timeout-callback': () => setToken(''),
      });
      return true;
    };
    if (!render()) {
      if (!document.getElementById('cf-turnstile-script')) {
        const s = document.createElement('script');
        s.id = 'cf-turnstile-script';
        s.src = TURNSTILE_SRC;
        s.async = true;
        s.defer = true;
        document.head.appendChild(s);
      }
      timer = setInterval(() => {
        if (render()) clearInterval(timer);
      }, 200);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [turnstileSiteKey]);

  const list = useMemo(() => [...pending, ...(comments ?? [])], [pending, comments]);
  const approvedCount = comments?.length ?? 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = content.trim();
    if (!text || submitting) return;
    if (turnstileSiteKey && !token) {
      setError('请先完成人机验证');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          articleId,
          content: text,
          authorName: name,
          website: hp,
          turnstileToken: token,
        }),
      });
      const d = await res.json();
      // 令牌一次性：无论成败都重置，避免复用导致下次校验失败
      if (turnstileSiteKey && window.turnstile) {
        window.turnstile.reset(tsWidgetId.current ?? undefined);
        setToken('');
      }
      if (d.ok) {
        // 乐观展示：本人立即看到自己的评论，标「审核中」
        setPending((p) => [
          {
            id: `local-${p.length}-${text.length}`,
            content: text,
            authorName: name.trim() || '匿名',
            createdAt: new Date().toISOString(),
            pending: true,
          },
          ...p,
        ]);
        setContent('');
      } else {
        setError(d.error ?? '提交失败');
      }
    } catch {
      setError('提交失败，请稍后再试');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mt-4 rounded-lg bg-white p-4" aria-label="评论区">
      <div className="mb-3 flex items-baseline gap-2 border-b border-gray-100 pb-2">
        <h2 className="border-l-4 border-brand pl-2 text-base font-bold text-gray-900">评论</h2>
        <span className="text-sm text-gray-400">{approvedCount}</span>
      </div>

      {/* 发表评论 */}
      <form onSubmit={submit} className="mb-5 flex gap-3">
        {/* 蜜罐字段（隐藏，防机器人）——真人看不到也不会填 */}
        <input
          type="text"
          name="website"
          value={hp}
          onChange={(e) => setHp(e.target.value)}
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          className="hidden"
        />
        <Avatar name={name || '我'} />
        <div className="min-w-0 flex-1">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="说点什么吧…"
            maxLength={1000}
            rows={3}
            className="w-full resize-y rounded-lg border border-gray-200 p-2.5 text-sm outline-none focus:border-brand"
          />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="昵称（选填）"
              maxLength={50}
              className="h-8 w-36 rounded border border-gray-200 px-2 text-sm outline-none focus:border-brand"
            />
            <span className="text-xs text-gray-300">{content.length}/1000</span>
            <button
              type="submit"
              disabled={submitting || !content.trim() || (!!turnstileSiteKey && !token)}
              className="ml-auto rounded-full bg-brand px-5 py-1.5 text-sm text-white transition hover:bg-brand-dark disabled:opacity-50"
            >
              {submitting ? '提交中…' : '发表'}
            </button>
          </div>
          {/* Turnstile 无感人机验证（invisible，不渲染可见组件）*/}
          {turnstileSiteKey ? <div ref={tsRef} /> : null}
          <p className="mt-1.5 text-xs text-gray-400">
            {error ? <span className="text-brand">{error}</span> : '评论将在审核通过后公开展示。'}
          </p>
        </div>
      </form>

      {/* 评论列表 */}
      {comments === null ? (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <div key={i} className="flex animate-pulse gap-3">
              <span className="h-9 w-9 shrink-0 rounded-full bg-gray-100" />
              <div className="flex-1 space-y-2 py-1">
                <span className="block h-3 w-24 rounded bg-gray-100" />
                <span className="block h-3 w-3/4 rounded bg-gray-100" />
              </div>
            </div>
          ))}
        </div>
      ) : list.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-400">还没有评论，来抢沙发吧～</p>
      ) : (
        <ul className="space-y-4">
          {list.map((c) => (
            <li key={c.id} className="flex gap-3">
              <Avatar name={c.authorName || '匿名'} />
              <div className="min-w-0 flex-1">
                <div className="mb-0.5 flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-700">{c.authorName || '匿名'}</span>
                  {c.pending ? (
                    <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-600">
                      审核中
                    </span>
                  ) : null}
                  <time className="text-xs text-gray-300" dateTime={c.createdAt}>
                    {fmt(c.createdAt)}
                  </time>
                </div>
                <p className={`text-sm leading-6 ${c.pending ? 'text-gray-400' : 'text-gray-800'}`}>
                  {c.content}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
