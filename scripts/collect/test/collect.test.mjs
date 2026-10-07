// node --test scripts/collect/test/collect.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBlockedIp, assertAllowedUrl, safeGet } from '../lib/safe-fetch.mjs';
import { parseRobots, robotsAllows, robotsCrawlDelay } from '../lib/robots.mjs';
import { parseSitemap, parseRss, filterByPath, normalizeUrl } from '../lib/discover.mjs';
import { extractMeta, clip } from '../lib/extract.mjs';
import { matchPrompt } from '../lib/match.mjs';

test('isBlockedIp: private, loopback, link-local, CGNAT and v6 special ranges', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '0.0.0.0', '::1', '::', 'fc00::1', 'fd12::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1']) {
    assert.equal(isBlockedIp(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '172.32.0.1', '100.128.0.1', '203.116.1.1', '2606:4700::1111']) {
    assert.equal(isBlockedIp(ip), false, ip);
  }
});

test('assertAllowedUrl: scheme, credentials and IP literals', () => {
  assert.throws(() => assertAllowedUrl(new URL('file:///etc/passwd')));
  assert.throws(() => assertAllowedUrl(new URL('ftp://example.com/')));
  assert.throws(() => assertAllowedUrl(new URL('http://user:pw@example.com/')));
  assert.throws(() => assertAllowedUrl(new URL('http://127.0.0.1:1337/api')));
  assert.throws(() => assertAllowedUrl(new URL('http://[::1]:3100/')));
  assert.doesNotThrow(() => assertAllowedUrl(new URL('https://www.zaobao.com.sg/news')));
});

test('safeGet refuses hostnames that resolve to loopback', async () => {
  await assert.rejects(safeGet('http://localhost:1337/'), /内网/);
});

test('robots: merged * groups, longest match, Allow on tie, crawl-delay', () => {
  const g = parseRobots([
    'User-agent: *', 'Crawl-delay: 10', 'User-agent: *', 'Allow: /core/*.css$',
    'User-agent: Sogou web spider', 'Disallow: /',
    'User-agent: *', 'Disallow:', 'Disallow: /search/', 'Disallow: /*.php$', 'Disallow: /feed/', 'Allow: /feed/public',
  ].join('\n'));
  assert.equal(robotsAllows(g, '/news/china/story1'), true);
  assert.equal(robotsAllows(g, '/search/x'), false);
  assert.equal(robotsAllows(g, '/index.php'), false);
  assert.equal(robotsAllows(g, '/index.php?x=1'), true);
  assert.equal(robotsAllows(g, '/feed/'), false);
  assert.equal(robotsAllows(g, '/feed/public'), true);
  assert.equal(robotsCrawlDelay(g), 10);
  assert.equal(robotsAllows(parseRobots(''), '/anything'), true);
});

test('sitemap: index and Google News urlset', () => {
  const idx = parseSitemap('<sitemapindex><sitemap><loc>https://a.com/s1.xml</loc><lastmod>2026-10-07</lastmod></sitemap></sitemapindex>');
  assert.deepEqual(idx, { type: 'index', sitemaps: [{ url: 'https://a.com/s1.xml', lastmod: '2026-10-07T00:00:00.000Z' }] });
  const set = parseSitemap(`<urlset><url><loc>https://a.com/news/x?a=1&amp;b=2</loc>
    <news:news><news:publication_date>2026-10-07T20:45:23+08:00</news:publication_date>
    <news:title><![CDATA[标题 A&B]]></news:title></news:news></url></urlset>`);
  assert.equal(set.type, 'urlset');
  assert.equal(set.entries[0].url, 'https://a.com/news/x?a=1&b=2');
  assert.equal(set.entries[0].title, '标题 A&B');
  assert.equal(set.entries[0].publishedAt, '2026-10-07T12:45:23.000Z');
});

test('rss and atom', () => {
  const rss = parseRss('<rss><channel><item><title>T</title><link>https://a.com/1</link><description>&lt;p&gt;摘要&lt;/p&gt;</description><pubDate>Tue, 07 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>');
  assert.deepEqual(rss[0], { url: 'https://a.com/1', title: 'T', summary: '摘要', publishedAt: '2026-10-07T10:00:00.000Z' });
  const atom = parseRss('<feed><entry><title>A</title><link href="https://a.com/2"/><updated>2026-10-07T10:00:00Z</updated></entry></feed>');
  assert.equal(atom[0].url, 'https://a.com/2');
});

test('filterByPath and normalizeUrl', () => {
  const es = [{ url: 'https://a.com/news/a' }, { url: 'https://a.com/finance/b' }, { url: 'https://a.com/news/live/c' }];
  assert.deepEqual(filterByPath(es, { includePaths: ['/news/'], excludePaths: ['/news/live/'] }).map((e) => e.url), ['https://a.com/news/a']);
  assert.equal(filterByPath(es, null).length, 3);
  assert.equal(normalizeUrl('https://a.com/x?utm_source=1&id=2#top'), 'https://a.com/x?id=2');
});

test('extractMeta: attribute order, entities, fallbacks', () => {
  const m = extractMeta(`<html><head><title>T &amp; Co</title>
    <meta content="描述 &quot;引号&quot;" property="og:description">
    <meta name="article:published_time" content="2026-10-07T20:00:00+08:00"></head></html>`);
  assert.equal(m.title, 'T & Co');
  assert.equal(m.summary, '描述 "引号"');
  assert.equal(m.publishedAt, '2026-10-07T12:00:00.000Z');
  assert.equal(clip('一'.repeat(250)).length, 200);
});

test('matchPrompt: no fallback, specificity, mode and provider', () => {
  const source = { documentId: 'S1', mode: 'reference' };
  const other = { documentId: 'S2', mode: 'reference' };
  const cat = { documentId: 'C1' };
  const providerNames = new Set(['wujiai']);
  const P = (o) => ({ enabled: true, matchMode: 'any', provider: 'wujiai', priority: 0, matchSources: [], matchCategories: [], ...o });
  const prompts = [
    P({ documentId: 'id1', stage: 'identify', matchSources: [{ documentId: 'S1' }] }),
    P({ documentId: 'w-cat', stage: 'write', matchCategories: [{ documentId: 'C1' }] }),
    P({ documentId: 'w-src', stage: 'write', matchSources: [{ documentId: 'S1' }], matchCategories: [{ documentId: 'C1' }] }),
    P({ documentId: 'w-none', stage: 'write', priority: 99 }),
    P({ documentId: 'r-lic', stage: 'review', matchMode: 'licensed', matchCategories: [{ documentId: 'C1' }] }),
    P({ documentId: 'r-bad', stage: 'review', provider: 'nope', matchCategories: [{ documentId: 'C1' }] }),
  ];
  assert.equal(matchPrompt(prompts, 'identify', { source, providerNames }).documentId, 'id1');
  assert.equal(matchPrompt(prompts, 'identify', { source: other, providerNames }), null);
  assert.equal(matchPrompt(prompts, 'write', { source, category: cat, providerNames }).documentId, 'w-src');
  assert.equal(matchPrompt(prompts, 'write', { source: other, category: cat, providerNames }).documentId, 'w-cat');
  assert.equal(matchPrompt(prompts, 'write', { source, category: null, providerNames }), null);
  assert.equal(matchPrompt(prompts, 'review', { source, category: cat, providerNames }), null);
});
