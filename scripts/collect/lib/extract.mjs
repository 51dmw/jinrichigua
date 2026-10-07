// Reference-mode extraction: only what the page itself publishes as metadata
// (title, description, publish time, cover). Body text is never read or stored in this mode.
import { decodeEntities } from './discover.mjs';

export const SUMMARY_MAX = 200;

export function extractMeta(html) {
  const metas = {};
  for (const m of String(html || '').matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = {};
    for (const a of m[0].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1].toLowerCase()] = a[2] ?? a[3];
    const key = (attrs.property || attrs.name || attrs.itemprop || '').toLowerCase();
    if (key && attrs.content && !(key in metas)) metas[key] = decodeEntities(attrs.content).replace(/\s+/g, ' ').trim();
  }
  const titleTag = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const published = metas['article:published_time'] || metas['og:article:published_time'] || metas['pubdate'] || metas['datepublished'];
  const t = published ? Date.parse(published) : NaN;
  return {
    title: metas['og:title'] || metas['twitter:title'] || (titleTag ? decodeEntities(titleTag).trim() : '') || null,
    summary: metas['og:description'] || metas['description'] || metas['twitter:description'] || null,
    publishedAt: Number.isNaN(t) ? null : new Date(t).toISOString(),
    image: metas['og:image'] || metas['twitter:image'] || null,
  };
}

export function clip(s, max = SUMMARY_MAX) {
  const t = String(s || '').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
