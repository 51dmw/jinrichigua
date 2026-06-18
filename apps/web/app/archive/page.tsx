import type { Metadata } from 'next';
import Link from 'next/link';
import { getArchiveIndex, getGlobal } from '@/lib/strapi';
import { resolveMetadata } from '@/lib/seo';
import { Breadcrumb } from '@/components/Breadcrumb';
import { HotList } from '@/components/HotList';
import { TagCloud } from '@/components/TagCloud';

export const revalidate = 300; // ISR：归档随发布缓慢变化

export async function generateMetadata(): Promise<Metadata> {
  const global = await getGlobal();
  return resolveMetadata({
    global,
    fallbackTitle: '文章归档',
    fallbackDescription: '按年月浏览今日吃瓜的全部历史文章。',
    path: '/archive',
  });
}

export default async function ArchivePage() {
  const years = await getArchiveIndex();

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start lg:gap-5">
      <div className="min-w-0">
        <Breadcrumb
          items={[
            { name: '首页', path: '/' },
            { name: '文章归档', path: '/archive' },
          ]}
        />
        <h1 className="mb-3 border-l-4 border-brand pl-2 text-lg font-bold">文章归档</h1>

        {years.length === 0 ? (
          <p className="rounded-lg bg-white p-6 text-center text-sm text-gray-500">暂无归档内容。</p>
        ) : (
          <div className="space-y-3">
            {years.map((y) => (
              <section key={y.year} className="rounded-lg bg-white p-4">
                <div className="mb-3 flex items-baseline gap-2 border-b border-gray-100 pb-2">
                  <h2 className="text-base font-bold text-gray-900">{y.year} 年</h2>
                  <span className="text-xs text-gray-400">{y.total} 篇</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {y.months.map((m) => (
                    <Link
                      key={m.month}
                      href={`/archive/${y.year}/${m.month}`}
                      className="flex items-baseline gap-1.5 rounded bg-gray-100 px-3 py-1.5 text-sm text-gray-700 transition hover:bg-brand/10 hover:text-brand"
                    >
                      <span>{m.month} 月</span>
                      <span className="text-xs text-gray-400">{m.count}</span>
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      <aside className="lg:sticky lg:top-16">
        <HotList title="热门排行" />
        <TagCloud />
      </aside>
    </div>
  );
}
