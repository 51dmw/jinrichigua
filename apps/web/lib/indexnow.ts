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
  /** 探测结果不是 200、因而没有提交的条数 */
  filtered: number;
  /**
   * filtered 里属于「暂时性」的条数（5xx / 超时 / 连不上）。
   * 兜底扫描看这个值决定要不要保持游标——见 apps/cms/config/cron.ts。
   */
  retryable: number;
}

/**
 * 提交前存活探测：**只有 200 才提交，其余一律不提交**。
 *
 * 走本机回环而不是公网域名：绕开 Cloudflare/WAF，也省掉一圈 TLS 和 CDN 延迟。
 * 判定分三档，区别只在「要不要再来一次」：
 *   200          → ok    提交
 *   3xx/4xx      → skip  不提交，也不必重试（跳转说明它不是正规地址，404/410 是没了）
 *   5xx/超时/异常 → retry 不提交，但算暂时性，交给兜底扫描下一轮重来
 */
const PROBE_BASE = (
  process.env.INDEXNOW_PROBE_BASE ?? `http://127.0.0.1:${process.env.PORT ?? 3100}`
).replace(/\/$/, '');
const PROBE_CONCURRENCY = 12;
/**
 * 10 秒：预热过的页面只要 6~200ms，但**刚发版重启后的首次渲染要回源 Strapi**，
 * 实测能超过 4 秒。超时定太紧会把正常文章误判成暂时性失败，白等一轮兜底。
 */
const PROBE_TIMEOUT_MS = 10_000;

type Verdict = 'ok' | 'skip' | 'retry';

async function probeOnce(url: string): Promise<Verdict> {
  const probeUrl = url.startsWith(SITE_URL) ? `${PROBE_BASE}${url.slice(SITE_URL.length) || '/'}` : url;
  try {
    const res = await fetch(probeUrl, {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (res.status === 200) return 'ok';
    return res.status >= 500 ? 'retry' : 'skip';
  } catch {
    return 'retry';
  }
}

/**
 * 探测一条 URL。判为暂时性时**当场再试一次**：
 * 第一次多半是冷页面在回源，第二次它已经生成好了，直接命中。
 * 还失败才算 retry，交给兜底扫描下一轮。
 */
async function probe(url: string): Promise<Verdict> {
  const first = await probeOnce(url);
  if (first !== 'retry') return first;
  return probeOnce(url);
}

/** 并发探测，保持原顺序分流。 */
async function classify(
  urls: string[],
): Promise<{ alive: string[]; filtered: number; retryable: number }> {
  const verdicts: Verdict[] = new Array(urls.length).fill('retry');
  let cursor = 0;
  const workers = Array.from({ length: Math.min(PROBE_CONCURRENCY, urls.length) }, async () => {
    while (cursor < urls.length) {
      const i = cursor++;
      verdicts[i] = await probe(urls[i]);
    }
  });
  await Promise.all(workers);
  const alive = urls.filter((_, i) => verdicts[i] === 'ok');
  return {
    alive,
    filtered: urls.length - alive.length,
    retryable: verdicts.filter((v) => v === 'retry').length,
  };
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
  const empty = { submitted: 0, skipped: 0, filtered: 0, retryable: 0 };
  if (!INDEXNOW_KEY) return { ok: false, reason: 'INDEXNOW_KEY 未配置', ...empty };

  const now = Date.now();
  dropExpired(now);
  const all = Array.from(new Set(urls.filter(Boolean).map(toAbsolute)));
  if (all.length === 0) return { ok: false, reason: 'empty url list', ...empty };

  const fresh = opts.force ? all : all.filter((u) => !submittedAt.has(u));
  const skipped = all.length - fresh.length;
  if (fresh.length === 0) {
    return { ok: true, reason: 'deduped（窗口内已提交过）', ...empty, skipped };
  }

  // 存活探测放在去重之后：窗口内已提交过的不必再探，省一轮请求。
  const { alive: list, filtered, retryable } = await classify(fresh);
  if (list.length === 0) {
    return {
      ok: true,
      reason: `无 200 可提交（过滤 ${filtered}，其中暂时性 ${retryable}）`,
      submitted: 0,
      skipped,
      filtered,
      retryable,
    };
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
  return {
    ok,
    reason: Array.from(new Set(reasons)).join(','),
    submitted,
    skipped,
    filtered,
    retryable,
  };
}
