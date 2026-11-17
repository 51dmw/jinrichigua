import type { Metadata } from 'next';
import Link from 'next/link';

// 404 页标题用 absolute 绕过 layout 的 titleTemplate（避免「| 今日吃瓜」重复叠加）。
// robots 不显式设置：Next 已对 not-found 自动注入 <meta robots=noindex>，再设会重复（§4）。
export const metadata: Metadata = {
  title: { absolute: '页面未找到 | 今日吃瓜' },
};

export default function NotFound() {
  return (
    <div className="mx-auto max-w-screen px-4 py-16 text-center lg:max-w-5xl">
      <p className="text-5xl font-bold text-brand">404</p>
      <h1 className="mt-3 text-lg font-bold text-gray-900">页面未找到</h1>
      <p className="mt-2 text-sm text-gray-500">
        你要找的瓜可能已下架，或者链接失效了。
      </p>
      <Link
        href="/"
        className="mt-6 inline-block rounded-lg bg-brand px-5 py-2.5 text-sm font-bold text-white transition hover:bg-brand-dark"
      >
        返回首页 ›
      </Link>

      {/* 引导出口（SEO 审计 #34）：状态码与 noindex 本来就对，缺的是降跳出率的去处。
          这些是纯静态链接，不取数据——404 页要保证在任何后端故障下都能渲染。 */}
      <div className="mt-8 border-t border-gray-200 pt-6 text-left">
        <h2 className="mb-3 text-center text-sm font-bold text-gray-700">换个地方接着吃瓜</h2>
        <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm">
          {[
            { href: '/hot', label: '吃瓜热榜' },
            { href: '/star', label: '明星娱乐' },
            { href: '/influencer', label: '网红达人' },
            { href: '/society', label: '社会大瓜' },
            { href: '/inside', label: '爆料内幕' },
            { href: '/dirt', label: '黑料档案' },
            { href: '/love', label: '情感婚恋' },
            { href: '/oversea', label: '海外吃瓜' },
            { href: '/archive', label: '文章归档' },
            { href: '/search', label: '站内搜索' },
          ].map((it) => (
            <li key={it.href}>
              <Link
                href={it.href}
                className="inline-flex min-h-[44px] items-center px-2 text-brand hover:underline"
              >
                {it.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
