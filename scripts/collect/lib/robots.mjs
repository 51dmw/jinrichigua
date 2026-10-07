// Minimal robots.txt support (RFC 9309): groups for our token are used if any exist, otherwise all
// `*` groups are merged; the longest matching rule wins and ties go to Allow. `*` and `$` are honoured.
// Crawl-delay is not in the RFC but is read because sites like zaobao rely on it.

export const ROBOTS_TOKEN = 'tobaoliaocollect';

export function parseRobots(text) {
  const groups = [];
  let current = null;
  let lastWasAgent = false;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      if (!lastWasAgent || !current) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === 'allow' || key === 'disallow') {
      if (value) current.rules.push({ allow: key === 'allow', path: value });
      // an empty Disallow means "allow everything" and adds no rule
    } else if (key === 'crawl-delay') {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.crawlDelay = n;
    }
  }
  return groups;
}

function groupsFor(groups, token) {
  const own = groups.filter((g) => g.agents.some((a) => a !== '*' && token.includes(a)));
  return own.length ? own : groups.filter((g) => g.agents.includes('*'));
}

function patternToRegex(path) {
  const anchored = path.endsWith('$');
  const body = (anchored ? path.slice(0, -1) : path)
    .split('*')
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

// pathWithQuery: e.g. "/news/china/story2026..." (include the query string if any)
export function robotsAllows(groups, pathWithQuery, token = ROBOTS_TOKEN) {
  let best = null;
  for (const g of groupsFor(groups, token)) {
    for (const r of g.rules) {
      if (!patternToRegex(r.path).test(pathWithQuery)) continue;
      const len = r.path.length;
      if (!best || len > best.len || (len === best.len && r.allow)) best = { len, allow: r.allow };
    }
  }
  return best ? best.allow : true;
}

export function robotsCrawlDelay(groups, token = ROBOTS_TOKEN) {
  const delays = groupsFor(groups, token).map((g) => g.crawlDelay).filter((d) => d !== null);
  return delays.length ? Math.max(...delays) : 0;
}
