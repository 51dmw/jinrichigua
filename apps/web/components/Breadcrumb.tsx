import Link from 'next/link';
import { breadcrumbJsonLd } from '@/lib/seo';
import { JsonLd } from './JsonLd';

export type Crumb = { name: string; path: string };

/** 面包屑根节点用品牌名（SEO：品牌词写进每页 BreadcrumbList 结构化数据）。 */
const HOME_BRAND = '今日吃瓜';

/**
 * 全站统一面包屑（§4）。一处同时输出：
 *  - 可见的 <nav> 面包屑（最后一项为当前页，不可点）
 *  - BreadcrumbList JSON-LD（所有层级含 item URL，利于富结果）
 * 根节点（path==='/'）显示为品牌名「今日吃瓜」；导航栏的「首页」按钮不受影响。
 */
export function Breadcrumb({ items, className = '' }: { items: Crumb[]; className?: string }) {
  if (items.length === 0) return null;
  const crumbs = items.map((it) => (it.path === '/' ? { ...it, name: HOME_BRAND } : it));
  return (
    <>
      <JsonLd data={breadcrumbJsonLd(crumbs)} />
      <nav aria-label="面包屑" className={`mb-2 text-xs text-gray-500 ${className}`}>
        {crumbs.map((it, i) => {
          const last = i === crumbs.length - 1;
          return (
            <span key={it.path}>
              {i > 0 ? <span className="mx-1 text-gray-500">/</span> : null}
              {last ? (
                <span className="font-medium text-gray-600" aria-current="page">
                  {it.name}
                </span>
              ) : (
                <Link
                  href={it.path}
                  className="text-gray-500 underline-offset-2 transition-colors hover:text-brand hover:underline"
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
