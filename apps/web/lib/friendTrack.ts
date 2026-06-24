/**
 * 友链埋点工具（友链统计第1期）。
 * 服务端（middleware / app/go）以共享密钥头调用 Strapi 写入来路/去路原始日志。
 * 仅用 Web 标准 API（fetch / AbortController），可在 Edge(middleware) 与 Node 运行时通用。
 */
import { STRAPI_API_URL, FRIEND_TRACK_SECRET } from './env';

/**
 * 取「真实客户端 IP」。站在 Cloudflare 后面，直连 IP 是 CF 边缘节点，
 * MUST 用 CF-Connecting-IP；回退 X-Forwarded-For 首个（最左为原始客户端）。
 */
export function clientIp(headers: Headers): string {
  const cf = headers.get('cf-connecting-ip');
  if (cf) return cf.trim();
  const xff = headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return '';
}

/**
 * 发送一条埋点。失败/超时静默吞掉——埋点绝不阻塞或影响前台跳转。
 * 未配置 FRIEND_TRACK_SECRET 时直接跳过（开发环境）。
 */
export async function fireFriendTrack(input: {
  code: string;
  type: 'in' | 'out';
  ip: string;
  ua: string;
}): Promise<void> {
  if (!FRIEND_TRACK_SECRET) return;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2000);
  try {
    await fetch(`${STRAPI_API_URL}/api/friend-link/track`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-friend-track-secret': FRIEND_TRACK_SECRET,
      },
      body: JSON.stringify(input),
      cache: 'no-store',
      signal: ctrl.signal,
    });
  } catch {
    /* 埋点失败不影响主流程 */
  } finally {
    clearTimeout(timer);
  }
}
