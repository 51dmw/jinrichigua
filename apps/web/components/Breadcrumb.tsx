import Link from 'next/link';
import { pageGraphJsonLd } from '@/lib/seo';
import { JsonLd } from './JsonLd';

export type Crumb = { name: string; path: string };

/** 面包屑根节点用品牌名（SEO：品牌词写进每页 BreadcrumbList 结构化数据）。 */
const HOME_BRAND = '今日吃瓜';

/**
 * 全站统一面包屑（§4）。一处同时输出：
 *  - 可见的 <nav> 面包屑（最后一项为当前页，不可点）
 *  - WebPage + BreadcrumbList 的 @graph JSON-LD（靠 @id 与站点实体图闭环，见 lib/seo.ts）
 * 根节点（path==='/'）显示为品牌名「今日吃瓜」；导航栏的「首页」按钮不受影响。
 */
export function Breadcrumb({
  items,
  className = '',
  tone = 'dark',
}: {
  items: Crumb[];
  className?: string;
  /** dark：直接放在淡黑页面底上（默认）；light：放在白卡片里（文章页） */
  tone?: 'dark' | 'light';
}) {
  if (items.length === 0) return null;
  const c =
    tone === 'light'
      ? { base: 'text-gray-500', current: 'text-gray-600', hover: 'hover:text-brand' }
      : { base: 'text-gray-400', current: 'text-gray-300', hover: 'hover:text-white' };
  const crumbs = items.map((it) => (it.path === '/' ? { ...it, name: HOME_BRAND } : it));
  return (
    <>
      <JsonLd data={pageGraphJsonLd(crumbs)} />
      <nav aria-label="面包屑" className={`mb-2 text-xs ${c.base} ${className}`}>
        {crumbs.map((it, i) => {
          const last = i === crumbs.length - 1;
          return (
            <span key={it.path}>
              {i > 0 ? <span className={`mx-1 ${c.base}`}>/</span> : null}
              {last ? (
                <span className={`font-medium ${c.current}`} aria-current="page">
                  {it.name}
                </span>
              ) : (
                <Link
                  href={it.path}
                  className={`${c.base} underline-offset-2 transition-colors ${c.hover} hover:underline`}
                >
                  {it.name}
                </Link>
              )}
            </span>
          );
        })}
      </nav>
    </>
  );
}
