// SSRF-guarded HTTP(S) GET for the collect pipeline.
// This VPS also runs the CMS (1337), the web front (3100), tgbot (3000) and several Docker networks,
// so every hop is checked: http/https only, no private / loopback / link-local targets, the IP is
// validated inside the socket's own DNS lookup (no rebinding window), redirects are re-validated,
// and both body size and total time are capped.
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import zlib from 'node:zlib';

export const COLLECT_UA = 'Mozilla/5.0 (compatible; TobaoliaoCollect/0.1; +https://tobaoliao.com/)';

const BLOCKED_V4 = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
];

function v4ToInt(ip) {
  return ip.split('.').reduce((acc, octet) => ((acc << 8) + Number(octet)) >>> 0, 0);
}

export function isBlockedIp(ip) {
  if (net.isIPv4(ip)) {
    const n = v4ToInt(ip);
    return BLOCKED_V4.some(([base, bits]) => ((n ^ v4ToInt(base)) >>> (32 - bits)) === 0);
  }
  if (net.isIPv6(ip)) {
    const s = ip.toLowerCase();
    if (s === '::' || s === '::1') return true;
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedIp(mapped[1]);
    if (s.startsWith('::ffff:')) return true; // hex-form IPv4-mapped: refuse rather than decode
    const head = parseInt(s.split(':')[0] || '0', 16);
    if ((head & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((head & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((head & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    return false;
  }
  return true; // not an IP at all
}

class SsrfError extends Error {
  constructor(message) { super(message); this.code = 'ESSRF'; }
}

// Used as the socket's lookup, so the address that gets connected is the one that was checked.
function guardedLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return callback(err);
    const bad = addrs.find((a) => isBlockedIp(a.address));
    if (bad) return callback(new SsrfError(`拒绝内网地址：${hostname} → ${bad.address}`));
    if (options.all) return callback(null, addrs);
    return callback(null, addrs[0].address, addrs[0].family);
  });
}

export function assertAllowedUrl(u) {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new SsrfError(`只允许 http/https：${u.protocol}`);
  if (u.username || u.password) throw new SsrfError('网址不能带用户名密码');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  // IP literals never go through lookup, so check them here
  if (net.isIP(host) && isBlockedIp(host)) throw new SsrfError(`拒绝内网地址：${host}`);
}

function decoderFor(encoding) {
  switch ((encoding || '').trim().toLowerCase()) {
    case 'gzip': case 'x-gzip': return zlib.createGunzip();
    case 'deflate': return zlib.createInflate();
    case 'br': return zlib.createBrotliDecompress();
    default: return null;
  }
}

function requestOnce(u, { maxBytes, deadline, headers }) {
  return new Promise((resolve, reject) => {
    const lib = u.protocol === 'https:' ? https : http;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return reject(new Error('抓取超时'));
    const req = lib.request(u, {
      method: 'GET',
      lookup: guardedLookup,
      headers: { 'User-Agent': COLLECT_UA, Accept: '*/*', 'Accept-Encoding': 'gzip, deflate, br', ...headers },
    });
    const timer = setTimeout(() => req.destroy(new Error('抓取超时')), remaining);
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.on('response', (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        clearTimeout(timer);
        return resolve({ status, location: res.headers.location, headers: res.headers });
      }
      const declared = Number(res.headers['content-length'] || 0);
      if (declared > maxBytes) {
        req.destroy();
        clearTimeout(timer);
        return reject(new Error(`响应超过 ${Math.round(maxBytes / 1048576)}MB`));
      }
      const decoder = decoderFor(res.headers['content-encoding']);
      const stream = decoder ? res.pipe(decoder) : res;
      const chunks = [];
      let size = 0;
      stream.on('data', (c) => {
        size += c.length;
        if (size > maxBytes) {
          req.destroy();
          stream.destroy();
          clearTimeout(timer);
          reject(new Error(`响应超过 ${Math.round(maxBytes / 1048576)}MB`));
          return;
        }
        chunks.push(c);
      });
      stream.on('end', () => {
        clearTimeout(timer);
        resolve({ status, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') });
      });
      stream.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
    req.end();
  });
}

// Returns { status, url, headers, body }. Non-2xx statuses are returned, not thrown;
// SSRF violations, timeouts, oversize bodies and redirect loops are thrown.
export async function safeGet(url, { maxBytes = 10 * 1024 * 1024, timeoutMs = 30000, maxRedirects = 5, headers = {} } = {}) {
  const deadline = Date.now() + timeoutMs;
  let current = new URL(url);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    assertAllowedUrl(current);
    const res = await requestOnce(current, { maxBytes, deadline, headers });
    if (res.location) {
      current = new URL(res.location, current);
      continue;
    }
    return { status: res.status, url: current.href, headers: res.headers, body: res.body };
  }
  throw new Error(`重定向超过 ${maxRedirects} 跳`);
}
