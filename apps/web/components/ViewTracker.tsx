'use client';

import { useEffect } from 'react';

/**
 * PV 统计（§M6）。文章页挂载后向同源 /api/view 上报一次，由服务端转发给 Strapi
 * 自增 viewCount。用 sessionStorage 去重，避免刷新重复计数。
 */
export function ViewTracker({ documentId }: { documentId: string }) {
  useEffect(() => {
    if (!documentId) return;
    const key = `viewed:${documentId}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch {
      /* sessionStorage 不可用则照常上报 */
    }
    fetch('/api/view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentId }),
      keepalive: true,
    }).catch(() => {});
  }, [documentId]);

  return null;
}
