/**
 * IndexNow 推送（§4 MUST）。
 * 文章发布/更新/删除时把 URL 提交给 IndexNow API —— Yandex + Bing 即时收录。
 * （Google 不支持 IndexNow，仍靠 sitemap + GSC。）
 *
 * 验证：在 `https://<host>/indexnow-key.txt` 暴露 key（见 app/indexnow-key.txt/route.ts），
 * 提交时用 keyLocation 指向它。
 */
import { INDEXNOW_KEY, SITE_URL } from './env';

const ENDPOINT = 'https://api.indexnow.org/indexnow';

export async function submitToIndexNow(urls: string[]): Promise<{ ok: boolean; reason?: string }> {
  if (!INDEXNOW_KEY) return { ok: false, reason: 'INDEXNOW_KEY 未配置' };
  const list = Array.from(new Set(urls.filter(Boolean)));
  if (list.length === 0) return { ok: false, reason: 'empty url list' };

  const host = new URL(SITE_URL).host;
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host,
        key: INDEXNOW_KEY,
        keyLocation: `${SITE_URL}/indexnow-key.txt`,
        urlList: list,
      }),
    });
    // IndexNow 成功返回 200/202；本地 host 会被拒(422)属预期
    return { ok: res.ok, reason: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}
