import { NextResponse, type NextRequest, type NextFetchEvent } from 'next/server';
import { fireFriendTrack, clientIp } from '@/lib/friendTrack';

/**
 * 全站 URL 规范化（SEO，避免重复内容）+ 友链来路埋点（?ref=<code>）。
 *
 * 规范化：把非规范形式 308 永久跳到唯一规范 URL：
 *  - 折叠重复斜杠：/news//tech → /news/tech
 *  - 去掉结尾斜杠（根除外）：/news/ → /news
 *  - 路径小写：/News → /news（站内 slug 均为小写）
 * 查询参数原样保留（如搜索 ?q=、分页已改路径不再用参数）。
 * 带扩展名的文件(sitemap.xml / robots.txt / indexnow-key.txt / turbo.rss)、
 * _next、api 由 matcher 排除，不参与规范化。
 *
 * 来路埋点：任意页面带 ?ref=<渠道code> 时，服务端记一条 type:'in' 日志，
 * 再 301 跳到「去掉 ref」的同 URL（防缓存变体 + 重复内容）。
 */
export function middleware(req: NextRequest, event: NextFetchEvent) {
  // 用原生 URL（而非 req.nextUrl.clone()）：后者会携带尾斜杠语义、序列化时再补回斜杠。
  const url = new URL(req.url);
  // 反代后 req.url 的 host 是内部地址（如 127.0.0.1:3100），直接 redirect 会把
  // 用户/爬虫导向不可达的内部 host。用反代透传的 Host / X-Forwarded-Proto 纠正，
  // 使跳转的 Location 指向真实站点地址。
  const fwdHost = req.headers.get('host');
  if (fwdHost) {
    url.host = fwdHost;
    // URL host setter 不会清除原有端口（如内部 3100）；外部 Host 不含端口时显式清掉，
    // 否则 Location 会变成 sibian.xyz:3100。
    if (!fwdHost.includes(':')) url.port = '';
  }
  const fwdProto = req.headers.get('x-forwarded-proto');
  if (fwdProto) url.protocol = fwdProto;

  // ── 来路埋点：?ref=<code> ──（先于规范化处理）
  const ref = url.searchParams.get('ref');
  if (ref) {
    // 用 waitUntil 后台发埋点（不阻塞 301），Worker 会等其完成再回收。
    event.waitUntil(
      fireFriendTrack({
        code: ref,
        type: 'in',
        ip: clientIp(req.headers),
        ua: req.headers.get('user-agent') ?? '',
      }),
    );
    url.searchParams.delete('ref');
    const res = NextResponse.redirect(url, 301);
    res.headers.set('Cache-Control', 'no-store');
    return res;
  }

  const original = url.pathname;

  let normalized = original.replace(/\/{2,}/g, '/');
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  normalized = normalized.toLowerCase();

  if (normalized !== original) {
    url.pathname = normalized;
    return NextResponse.redirect(url, 308);
  }
  return NextResponse.next();
}

export const config = {
  // 排除 _next、api 以及任何带「.」的静态文件/特殊路由
  matcher: ['/((?!_next/|api/|.*\\.).*)'],
};
