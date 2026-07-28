import Link from 'next/link';
import type { GlobalSettings } from 'shared';
import { getFeaturedTags } from '@/lib/strapi';
import { FriendLinks } from './FriendLinks';

type FooterLink = { label: string; href: string };

const COLUMNS: { title: string; links: FooterLink[] }[] = [
  {
    title: '关于',
    links: [
      { label: '关于我们', href: '/info/about' },
      { label: '联络我们', href: '/info/contact' },
      { label: '常见问题', href: '/info/faq' },
    ],
  },
  {
    title: '政策条款',
    links: [
      { label: '内容政策', href: '/info/policy' },
      { label: '隐私政策', href: '/info/privacy' },
      { label: '使用协议', href: '/info/terms' },
    ],
  },
  {
    title: '合规',
    links: [
      { label: 'DMCA', href: '/info/dmca' },
      { label: '18 U.S.C. 2257', href: '/info/2257' },
    ],
  },
  {
    title: '更多',
    links: [
      { label: '吃瓜热榜', href: '/hot' },
      { label: '文章归档', href: '/archive' },
      { label: '热门搜索', href: '/info/hot-search' },
      { label: '其他', href: '/info/other' },
    ],
  },
];

/** 站点页脚（§8 ICP 占位）。多栏信息/法律链接 + 热门标签内链 + 版权/版本归属。 */
export async function SiteFooter({ global }: { global: GlobalSettings | null }) {
  const siteName = global?.siteName ?? 'News Portal';
  const year = new Date().getFullYear();
  const tags = await getFeaturedTags(12);

  return (
    <footer className="mt-8 border-t border-gray-200 bg-gray-50 text-gray-500">
      <div className="mx-auto max-w-screen px-4 py-6 lg:max-w-5xl">
        {/* 精选标签（按标签最热文章点击数排序，SEO 站内内链，每页可见）。
            触控目标 ≥44px（SEO 审计 #23）：原先 min-h-24px + px-1 远低于移动友好度门槛。
            取 44 而非报告建议的 48——44px 是 WCAG 2.5.8 与 iOS HIG 的实际标准，
            48px 会让这行标签在小屏上撑得过高。 */}
        {tags.length > 0 ? (
          <div className="mb-5 flex flex-wrap items-center gap-x-2 gap-y-2 text-xs">
            <span className="text-gray-500">精选标签：</span>
            {tags.map((t) => (
              <Link
                key={t.slug}
                href={`/tag/${t.slug}`}
                className="inline-flex min-h-[44px] items-center px-3 py-2 hover:text-brand"
              >
                {t.name}
              </Link>
            ))}
          </div>
        ) : null}

        {/* 友情链接（按 track 区分：走 /go 统计 或 直链保反链） */}
        <FriendLinks />

        {/* 链接分栏 */}
        <div className="grid grid-cols-2 gap-4 border-t border-gray-200 pt-5 text-sm sm:grid-cols-4">
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <h2 className="mb-2 font-medium text-gray-700">{col.title}</h2>
              <ul className="space-y-1.5">
                {col.links.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className="text-gray-500 hover:text-brand">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* 底栏：版权 + ICP + 版本归属 */}
      <div className="border-t border-gray-200 py-4 text-center text-xs text-gray-500">
        <div className="mx-auto max-w-screen px-4 lg:max-w-5xl">
          <p>
            © {year} {siteName}. 版权所有
            {global?.icpRecord ? (
              <>
                {' · '}
                <a
                  href="https://beian.miit.gov.cn/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-gray-600"
                >
                  {global.icpRecord}
                </a>
              </>
            ) : null}
          </p>
          <p className="mt-1 text-gray-500">© {siteName}</p>
        </div>
      </div>
    </footer>
  );
}
