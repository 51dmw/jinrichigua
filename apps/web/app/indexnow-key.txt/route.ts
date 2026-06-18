import { INDEXNOW_KEY } from '@/lib/env';

// 暴露 IndexNow 校验密钥：https://<host>/indexnow-key.txt（§4）。
export const dynamic = 'force-static';

export function GET(): Response {
  return new Response(INDEXNOW_KEY ?? '', {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
