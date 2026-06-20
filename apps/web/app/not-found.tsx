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
        你访问的页面不存在或已被移除。
      </p>
      <Link
        href="/"
        className="mt-6 inline-block rounded-lg bg-brand px-5 py-2.5 text-sm font-bold text-white transition hover:bg-brand-dark"
      >
        返回首页 ›
      </Link>
    </div>
  );
}
