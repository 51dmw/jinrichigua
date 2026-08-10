/**
 * IndexNow 推送（§4 MUST）。
 * 文章发布/更新/删除时把 URL 提交给 IndexNow API —— Yandex + Bing 即时收录。
 * （Google 不支持 IndexNow，仍靠 sitemap + GSC。）
 *
 * 验证：在 `https://<host>/indexnow-key.txt` 暴露 key（见 app/indexnow-key.txt/route.ts），
 * 提交时用 keyLocation 指向它。
 *
 * 调用方有两条：
 *   1) /api/revalidate —— CMS lifecycle 在文章发布/改动时即时 ping（秒级）；
 *   2) /api/indexnow  —— CMS 每 5 分钟的兜底扫描 + 历史回补（补第 1 条丢掉的）。
 * 两条路会推同一批 URL，靠下面的去重窗口收敛成一次真实提交。
 */
import { INDEXNOW_KEY, SITE_URL } from './env';

const ENDPOINT = 'https://api.indexnow.org/indexnow';

/** 协议规定单次请求最多 10000 条，超出自动分批。 */
const MAX_PER_REQUEST = 10_000;

/**
 * 去重窗口：同一 URL 6 小时内只真正提交一次。
 *
 * 只在提交成功后写入——失败的 URL 不进缓存，兜底扫描下一轮还会重试，这是「不漏推」的关键。
 * 缓存在进程内存里，前台重启即清空；而「前台重启」恰好就是即时推送可能丢失的场景，
 * 此时兜底扫描重推一遍正好补上，不会被过期的去重记录挡住。
 */
const DEDUPE_TTL_MS = 6 * 60 * 60 * 1000;
const submittedAt = new Map<string, number>();

export interface IndexNowResult {
  ok: boolean;
  reason?: string;
  /** 本次真正发给 IndexNow 的条数 */
  submitted: number;
  /** 命中去重窗口被跳过的条数 */
  skipped: number;
}

/** 站内路径 → 绝对 URL（已是绝对地址的原样返回）。 */
export function toAbsolute(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${SITE_URL}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
}

function dropExpired(now: number): void {
  for (const [url, ts] of submittedAt) {
    if (now - ts > DEDUPE_TTL_MS) submittedAt.delete(url);
  }
}

async function postBatch(list: string[]): Promise<{ ok: boolean; reason: string }> {
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

/**
 * 提交一批 URL（可传站内路径，内部转绝对地址）。
 * @param opts.force 跳过去重窗口——历史回补用，日常推送不要开。
 */
export async function submitToIndexNow(
  urls: string[],
  opts: { force?: boolean } = {},
): Promise<IndexNowResult> {
  if (!INDEXNOW_KEY) return { ok: false, reason: 'INDEXNOW_KEY 未配置', submitted: 0, skipped: 0 };

  const now = Date.now();
  dropExpired(now);
  const all = Array.from(new Set(urls.filter(Boolean).map(toAbsolute)));
  if (all.length === 0) return { ok: false, reason: 'empty url list', submitted: 0, skipped: 0 };

  const list = opts.force ? all : all.filter((u) => !submittedAt.has(u));
  const skipped = all.length - list.length;
  if (list.length === 0) {
    return { ok: true, reason: 'deduped（窗口内已提交过）', submitted: 0, skipped };
  }

  let submitted = 0;
  const reasons: string[] = [];
  let ok = true;
  for (let i = 0; i < list.length; i += MAX_PER_REQUEST) {
    const chunk = list.slice(i, i + MAX_PER_REQUEST);
    const res = await postBatch(chunk);
    reasons.push(res.reason);
    if (res.ok) {
      submitted += chunk.length;
      // 成功才记去重，失败留给兜底扫描重推
      for (const u of chunk) submittedAt.set(u, now);
    } else {
      ok = false;
    }
  }
  return { ok, reason: Array.from(new Set(reasons)).join(','), submitted, skipped };
}
