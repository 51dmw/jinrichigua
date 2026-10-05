// Minimal Strapi 5 REST client shared by the scripts/* pipelines.
// Each pipeline creates its own client with its own token — they never share credentials.

export function createStrapi({ url, token }) {
  if (!token) throw new Error('Strapi client 缺 API token');

  async function request(path, opts = {}) {
    const res = await fetch(`${url}/api${path}`, {
      ...opts,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...opts.headers },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Strapi ${opts.method || 'GET'} ${path} → ${res.status}: ${JSON.stringify(json.error || json).slice(0, 200)}`);
    return json;
  }

  async function fetchAllPages(path, qs = '') {
    const out = [];
    for (let page = 1; ; page++) {
      const json = await request(`${path}?pagination[page]=${page}&pagination[pageSize]=100${qs}`);
      out.push(...json.data);
      if (page >= (json.meta?.pagination?.pageCount || 1)) return out;
    }
  }

  // 远程图片 → Strapi 媒体库（自存避免防盗链/签名过期）。
  // 返回 { id, url, width, height }；任何一步失败返回 null，调用方照常继续（只是无图）。
  async function uploadMedia(srcUrl, name) {
    try {
      const res = await fetch(srcUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15' },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`http ${res.status}`);
      const type = (res.headers.get('content-type') || 'image/jpeg').split(';')[0];
      if (!type.startsWith('image/')) throw new Error(`非图片: ${type}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 2048) throw new Error('图片过小，疑似防盗链占位');
      const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
      const form = new FormData();
      form.append('files', new Blob([buf], { type }), `${name}.${ext}`);
      const up = await fetch(`${url}/api/upload`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
      });
      const json = await up.json();
      if (!up.ok) throw new Error(`upload ${up.status}: ${JSON.stringify(json.error || '').slice(0, 100)}`);
      const f = json[0];
      return f?.id ? { id: f.id, url: f.url, width: f.width, height: f.height } : null;
    } catch (e) {
      console.warn(`[warn] 图片采集失败(${e.message}): ${String(srcUrl).slice(0, 80)}`);
      return null;
    }
  }

  return { request, fetchAllPages, uploadMedia };
}
