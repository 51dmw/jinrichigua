'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import type { Channel } from 'shared';

type NavItem = { slug: string; name: string; href: string };

/**
 * 频道导航（吸顶 + 可折叠）。
 * - 一行横向滚动展示频道；右侧「展开」箭头打开全部频道网格（类目多时折叠，参考 i.ifeng）。
 * - 高亮当前频道（usePathname）。
 */
export function ChannelNav({ channels }: { channels: Channel[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // 当前激活段：'/' → 首页；'/news' 或 '/news/xxx' → news
  const activeSeg = pathname === '/' ? '' : pathname.split('/')[1] || '';

  // 吃瓜热榜（/hot）不进导航；入口走「频道热门」侧栏的「更多」链接。
  const items: NavItem[] = [
    { slug: '', name: '首页', href: '/' },
    ...channels.map((c) => ({ slug: c.slug, name: c.name, href: `/${c.slug}` })),
  ];
  const isActive = (it: NavItem) => it.slug === activeSeg;

  return (
    <nav
      aria-label="频道导航"
      className="sticky top-0 z-20 bg-brand shadow-sm"
    >
      <div className="relative mx-auto max-w-screen lg:max-w-5xl">
        <div className="flex items-stretch">
          {/* 横向滚动的一行频道 */}
          <ul className="flex flex-1 items-stretch overflow-x-auto text-sm [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {items.map((it) => (
              <li key={it.href} className="shrink-0 border-l border-white/20 last:border-r">
                <Link
                  href={it.href}
                  className={`block px-4 py-2.5 ${
                    isActive(it)
                      ? 'bg-brand-dark font-medium text-white'
                      : 'text-white hover:bg-white/10'
                  }`}
                >
                  {it.name}
                </Link>
              </li>
            ))}
          </ul>

          {/* 右侧展开/收起按钮（与右边缘对齐） */}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? '收起频道' : '展开全部频道'}
            className="flex w-11 shrink-0 items-center justify-center border-l border-white/20 text-white/80 hover:text-white"
          >
            <svg
              viewBox="0 0 24 24"
              className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        {/* 展开面板：全部频道网格 */}
        {open ? (
          <>
            <button
              aria-hidden
              tabIndex={-1}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-30 cursor-default bg-black/10"
            />
            <div className="absolute inset-x-0 top-full z-40 border-t border-white/15 bg-brand shadow-lg">
              <div className="grid grid-cols-4 gap-1 p-3 sm:grid-cols-5 lg:grid-cols-6">
                {items.map((it) => (
                  <Link
                    key={it.href}
                    href={it.href}
                    onClick={() => setOpen(false)}
                    className={`rounded px-2 py-2 text-center text-sm ${
                      isActive(it)
                        ? 'bg-brand-dark font-medium text-white'
                        : 'text-white hover:bg-white/10'
                    }`}
                  >
                    {it.name}
                  </Link>
                ))}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </nav>
  );
}
