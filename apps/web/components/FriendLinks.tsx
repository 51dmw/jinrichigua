import { getFriendLinks } from '@/lib/strapi';

/**
 * 友情链接（页脚区）。按 track 区分渲染（友链统计第1期）：
 *  - track=true  → href="/go?code=…"，rel="nofollow noopener noreferrer"（走去路统计）
 *  - track=false → href=真实 url，dofollow 时去掉 nofollow（保反链，不统计）
 * 无已启用友链时不渲染（返回 null）。
 */
export async function FriendLinks() {
  const links = await getFriendLinks();
  if (links.length === 0) return null;

  return (
    <nav aria-label="友情链接" className="mb-5 border-t border-gray-200 pt-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
        <span className="text-gray-500">友情链接：</span>
        {links.map((l) => {
          const tracked = l.track !== false;
          const href = tracked ? `/go?code=${encodeURIComponent(l.code)}` : l.url;
          // 走统计的一律 nofollow；不统计的按 dofollow 决定是否保反链。
          const rel =
            tracked || !l.dofollow
              ? 'nofollow noopener noreferrer'
              : 'noopener noreferrer';
          return (
            <a
              key={l.documentId}
              href={href}
              rel={rel}
              target="_blank"
              title={l.description ?? l.domain ?? l.name}
              className="text-gray-500 hover:text-brand"
            >
              {l.name}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
