// Discovery parsers: sitemap index, urlset (incl. Google News extension) and RSS/Atom.
// Regex-based on purpose: the inputs are machine-generated feeds and only a handful of fields are read.

export function decodeEntities(s) {
  return String(s ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decodeEntities(m[1]).trim() : '';
}

function toIso(s) {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

// Returns { type: 'index', sitemaps: [{ url, lastmod }] } or { type: 'urlset', entries: [...] }.
export function parseSitemap(xml) {
  const text = String(xml || '');
  if (/<sitemapindex[\s>]/i.test(text)) {
    const sitemaps = [...text.matchAll(/<sitemap>([\s\S]*?)<\/sitemap>/gi)]
      .map((m) => ({ url: tag(m[1], 'loc'), lastmod: toIso(tag(m[1], 'lastmod')) }))
      .filter((s) => s.url);
    return { type: 'index', sitemaps };
  }
  const entries = [...text.matchAll(/<url>([\s\S]*?)<\/url>/gi)]
    .map((m) => {
      const b = m[1];
      return {
        url: tag(b, 'loc'),
        title: tag(b, 'news:title') || null,
        publishedAt: toIso(tag(b, 'news:publication_date')) || toIso(tag(b, 'lastmod')),
        summary: null,
      };
    })
    .filter((e) => e.url);
  return { type: 'urlset', entries };
}

export function parseRss(xml) {
  const text = String(xml || '');
  const items = [...text.matchAll(/<item[\s>]([\s\S]*?)<\/item>/gi)].map((m) => m[1]);
  if (items.length) {
    return items.map((b) => ({
      url: tag(b, 'link'),
      title: tag(b, 'title') || null,
      summary: stripTags(tag(b, 'description')) || null,
      publishedAt: toIso(tag(b, 'pubDate')) || toIso(tag(b, 'dc:date')),
    })).filter((e) => e.url);
  }
  // Atom
  return [...text.matchAll(/<entry[\s>]([\s\S]*?)<\/entry>/gi)].map((m) => {
    const b = m[1];
    const link = b.match(/<link\b[^>]*href="([^"]+)"/i)?.[1] || '';
    return {
      url: decodeEntities(link),
      title: tag(b, 'title') || null,
      summary: stripTags(tag(b, 'summary') || tag(b, 'content')) || null,
      publishedAt: toIso(tag(b, 'published')) || toIso(tag(b, 'updated')),
    };
  }).filter((e) => e.url);
}

export function stripTags(s) {
  return decodeEntities(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

// selectors.includePaths / excludePaths: pathname prefixes, e.g. ["/news/"]
export function filterByPath(entries, selectors) {
  const include = Array.isArray(selectors?.includePaths) ? selectors.includePaths : [];
  const exclude = Array.isArray(selectors?.excludePaths) ? selectors.excludePaths : [];
  return entries.filter((e) => {
    let path;
    try { path = new URL(e.url).pathname; } catch { return false; }
    if (include.length && !include.some((p) => path.startsWith(p))) return false;
    return !exclude.some((p) => path.startsWith(p));
  });
}

// Strips fragments and common tracking parameters so the same article is not collected twice.
export function normalizeUrl(u) {
  try {
    const url = new URL(u);
    url.hash = '';
    for (const k of [...url.searchParams.keys()]) {
      if (/^(utm_|spm$|from$|ref$|share)/i.test(k)) url.searchParams.delete(k);
    }
    return url.href;
  } catch {
    return u;
  }
}
