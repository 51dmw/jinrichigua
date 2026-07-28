'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/** 站内搜索框。提交跳转 /search?q=...（q 为搜索词，非分页参数）。 */
export function SearchBox({ initial = '', className = '' }: { initial?: string; className?: string }) {
  const router = useRouter();
  const [q, setQ] = useState(initial);

  return (
    // action/method/name 三件套是原生兜底（SEO 审计 #38）：禁用 JS 或爬虫解析时，
    // 表单仍能 GET 提交到 /search?q=…。也让 WebSite.potentialAction 里声明的
    // SearchAction 名副其实——之前只有 onSubmit，声明了搜索能力却没有可提交的表单。
    // JS 可用时下面的 onSubmit 会 preventDefault 走客户端路由，行为不变。
    <form
      role="search"
      action="/search"
      method="get"
      onSubmit={(e) => {
        e.preventDefault();
        const t = q.trim();
        if (t) router.push(`/search?q=${encodeURIComponent(t)}`);
      }}
      className={`flex items-center ${className}`}
    >
      <input
        type="search"
        name="q"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="搜索新闻"
        aria-label="站内搜索"
        className="h-8 w-full rounded-l-full border border-gray-200 bg-white px-3 text-sm text-gray-700 outline-none focus:border-brand"
      />
      <button
        type="submit"
        aria-label="搜索"
        className="flex h-8 shrink-0 items-center rounded-r-full bg-brand px-3 text-white"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4-4" strokeLinecap="round" />
        </svg>
      </button>
    </form>
  );
}
