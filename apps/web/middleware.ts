import { NextResponse, type NextRequest } from 'next/server';

/**
 * 全站 URL 规范化（SEO，避免重复内容）。把非规范形式 308 永久跳到唯一规范 URL：
 *  - 折叠重复斜杠：/news//tech → /news/tech
 *  - 去掉结尾斜杠（根除外）：/news/ → /news
 *  - 路径小写：/News → /news（站内 slug 均为小写）
 * 查询参数原样保留（如搜索 ?q=、分页已改路径不再用参数）。
 * 带扩展名的文件(sitemap.xml / robots.txt / indexnow-key.txt / turbo.rss)、
 * _next、api 由 matcher 排除，不参与规范化。
 */
export function middleware(req: NextRequest) {
  // 用原生 URL（而非 req.nextUrl.clone()）：后者会携带尾斜杠语义、序列化时再补回斜杠。
  const url = new URL(req.url);
  // 反代后 req.url 的 host 是内部地址（如 127.0.0.1:3100），直接 redirect 会把
  // 用户/爬虫导向不可达的内部 host。用反代透传的 Host / X-Forwarded-Proto 纠正，
  // 使 308 的 Location 指向真实站点地址。
  const fwdHost = req.headers.get('host');
  if (fwdHost) {
    url.host = fwdHost;
    // URL host setter 不会清除原有端口（如内部 3100）；外部 Host 不含端口时显式清掉，
    // 否则 Location 会变成 sibian.xyz:3100。
    if (!fwdHost.includes(':')) url.port = '';
  }
  const fwdProto = req.headers.get('x-forwarded-proto');
  if (fwdProto) url.protocol = fwdProto;
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
