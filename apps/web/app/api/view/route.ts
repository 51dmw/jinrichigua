import { NextRequest, NextResponse } from 'next/server';
import { STRAPI_API_URL, STRAPI_API_TOKEN } from '@/lib/env';

/**
 * PV 上报代理（§M6）。同源接收，转发给 Strapi 的 view 接口自增 viewCount。
 * 这样不必把 Strapi 地址暴露到客户端，也避免跨域。
 */
export async function POST(req: NextRequest) {
  let documentId = '';
  try {
    documentId = (await req.json())?.documentId ?? '';
  } catch {
    /* ignore */
  }
  if (!documentId) {
    return NextResponse.json({ ok: false, error: 'documentId required' }, { status: 400 });
  }

  try {
    const res = await fetch(`${STRAPI_API_URL}/api/articles/${encodeURIComponent(documentId)}/view`, {
      method: 'POST',
      headers: STRAPI_API_TOKEN ? { Authorization: `Bearer ${STRAPI_API_TOKEN}` } : {},
      cache: 'no-store',
    });
    return NextResponse.json({ ok: res.ok }, { status: res.ok ? 200 : 502 });
  } catch {
    return NextResponse.json({ ok: false }, { status: 502 });
  }
}
