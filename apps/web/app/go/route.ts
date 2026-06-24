import { NextRequest, NextResponse } from 'next/server';
import { SITE_URL } from '@/lib/env';
import { getFriendLinkUrlByCode } from '@/lib/strapi';
import { fireFriendTrack, clientIp } from '@/lib/friendTrack';

/**
 * 友链去路跳转 + 埋点（友链统计第1期）。GET /go?code=<渠道code>：
 *  1) 按 code 查「已启用」友链真实 url；查不到 → 302 回首页；
 *  2) 记一条 type:'out' 日志（带共享密钥头，取 CF 真实 IP）；
 *  3) 302 跳到友链真实 url。
 * 全程 no-store（埋点不可被缓存吞掉）。
 */
export async function GET(req: NextRequest) {
  const home = new URL('/', SITE_URL);
  const code = (req.nextUrl.searchParams.get('code') ?? '').trim();

  if (!code) {
    return NextResponse.redirect(home, 302);
  }

  const target = await getFriendLinkUrlByCode(code);
  if (!target) {
    const res = NextResponse.redirect(home, 302);
    res.headers.set('Cache-Control', 'no-store');
    return res;
  }

  // 先记去路日志再跳转（await 保证验收时日志已落库；2s 超时兜底见 fireFriendTrack）。
  await fireFriendTrack({
    code,
    type: 'out',
    ip: clientIp(req.headers),
    ua: req.headers.get('user-agent') ?? '',
  });

  const res = NextResponse.redirect(new URL(target), 302);
  res.headers.set('Cache-Control', 'no-store');
  return res;
}
