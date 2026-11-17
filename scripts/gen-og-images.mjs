#!/usr/bin/env node
/**
 * Generate static og:image files (1200x630 PNG) for the home page and every channel.
 *
 * Usage:  node scripts/gen-og-images.mjs
 * Output: apps/web/public/og/home.png
 *         apps/web/public/og/channel-<slug>.png
 *         apps/web/lib/og-manifest.json   (slugs that have an image; read by the web app)
 *
 * Re-run after adding/renaming a channel in the CMS, then redeploy the web app.
 * Channels without a generated image fall back to the global default og image.
 *
 * Rendering: SVG -> PNG via sharp (librsvg). Text uses the system font
 * "Noto Sans CJK SC" (must be installed: `fc-list | grep "Noto Sans CJK SC"`).
 */
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'apps/web');
// sharp is a transitive dependency of next; resolve it from there instead of adding a new dep
const requireFromNext = createRequire(createRequire(path.join(WEB, 'package.json')).resolve('next'));
const sharp = requireFromNext('sharp');

const STRAPI = (process.env.STRAPI_API_URL ?? 'http://127.0.0.1:1337').replace(/\/$/, '');
const SITE_NAME = process.env.OG_SITE_NAME ?? '今日吃瓜';
const SITE_HOST = process.env.OG_SITE_HOST ?? 'tobaoliao.com';

const W = 1200;
const H = 630;
const RED = '#e8212e';
const INK = '#1c1c1e';
const FONT = "'Noto Sans CJK SC', 'Noto Sans SC', sans-serif";

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Watermelon slice with a bite, a notification bubble and sparks. Drawn around (0,0), ~420px wide. */
function melon() {
  const seed = (x, y, r) =>
    `<ellipse cx="${x}" cy="${y}" rx="9" ry="15" fill="#2a1714" transform="rotate(${r} ${x} ${y})"/>`;
  return `
  <defs>
    <mask id="bite" maskUnits="userSpaceOnUse" x="-260" y="-80" width="520" height="340">
      <rect x="-260" y="-80" width="520" height="340" fill="#ffffff"/>
      <circle cx="150" cy="-6" r="44" fill="#000000"/>
      <circle cx="196" cy="30" r="34" fill="#000000"/>
      <circle cx="112" cy="-22" r="26" fill="#000000"/>
    </mask>
  </defs>
  <g transform="rotate(-24)" mask="url(#bite)">
    <path d="M -200 0 A 200 200 0 0 0 200 0 Z" fill="#1f8a3b"/>
    <path d="M -200 0 A 200 200 0 0 0 200 0" fill="none" stroke="#0f6b2c" stroke-width="10" stroke-dasharray="46 30"/>
    <path d="M -180 0 A 180 180 0 0 0 180 0 Z" fill="#f3f6dc"/>
    <path d="M -164 0 A 164 164 0 0 0 164 0 Z" fill="#ff2f45"/>
    <path d="M -150 14 A 150 150 0 0 0 -60 136" fill="none" stroke="#ff7482" stroke-width="12" stroke-linecap="round"/>
    ${seed(-70, 50, 20)}${seed(-10, 96, 0)}${seed(50, 52, -20)}${seed(-20, 34, 5)}${seed(72, 104, -30)}
  </g>
  <g fill="${RED}">
    <circle cx="150" cy="-128" r="9"/><circle cx="182" cy="-98" r="6"/><circle cx="128" cy="-96" r="5"/>
  </g>
  <g transform="translate(40 -190)">
    <circle r="46" fill="${RED}"/>
    <path d="M -8 40 L 4 62 L 14 38 Z" fill="${RED}"/>
    <path d="M 0 -26 C 14 -26 18 -12 18 0 C 18 8 22 12 26 16 L -26 16 C -22 12 -18 8 -18 0 C -18 -12 -14 -26 0 -26 Z" fill="#ffffff"/>
    <circle cy="23" r="6" fill="#ffffff"/>
  </g>
  <g stroke="#ffc21a" stroke-width="13" stroke-linecap="round">
    <line x1="112" y1="-236" x2="124" y2="-272"/>
    <line x1="140" y1="-206" x2="178" y2="-226"/>
    <line x1="146" y1="-168" x2="186" y2="-166"/>
  </g>
  <g transform="translate(96 22)">
    <path d="M -210 150 C -250 110 -300 120 -318 152 C -280 188 -236 186 -210 150 Z" fill="#1f8a3b"/>
    <path d="M -216 150 L -300 152" stroke="#0f6b2c" stroke-width="5" stroke-linecap="round"/>
  </g>`;
}

/** Heavy two-tone headline: leading chars in ink, last two in red. Slight forward slant like the brand art. */
function headline(text, x, y, size) {
  const chars = Array.from(text);
  const head = chars.length >= 3 ? chars.slice(0, -2).join('') : '';
  const tail = chars.length >= 3 ? chars.slice(-2).join('') : text;
  const t = (fill, s) => `<tspan fill="${fill}" stroke="${fill}">${esc(s)}</tspan>`;
  return `
  <g transform="translate(${x} ${y}) skewX(-8)">
    <text font-family="${FONT}" font-weight="700" font-size="${size}" stroke-width="${Math.round(size / 26)}"
          stroke-linejoin="round" letter-spacing="2">${head ? t(INK, head) : ''}${t(RED, tail)}</text>
  </g>`;
}

/** Tagline flanked by two short red bars. */
function tagline(text, x, y, size = 42) {
  const spacing = 8;
  const width = Array.from(text).length * (size + spacing);
  return `
  <rect x="${x}" y="${y - size * 0.42}" width="56" height="8" rx="4" fill="${RED}"/>
  <text x="${x + 80}" y="${y}" font-family="${FONT}" font-weight="700" font-size="${size}" fill="${INK}"
        letter-spacing="${spacing}">${esc(text)}</text>
  <rect x="${x + 80 + width + 16}" y="${y - size * 0.42}" width="56" height="8" rx="4" fill="${RED}"/>`;
}

function frame(inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  <circle cx="250" cy="330" r="300" fill="#fff0f1"/>
  <circle cx="1130" cy="60" r="150" fill="#fff5f5"/>
  ${inner}
  <rect y="${H - 16}" width="${W}" height="16" fill="${RED}"/>
  <text x="${W - 48}" y="${H - 44}" text-anchor="end" font-family="${FONT}" font-size="26" fill="#8a8a8e"
        letter-spacing="1">${esc(SITE_HOST)}</text>
</svg>`;
}

function homeSvg() {
  return frame(`
  <g transform="translate(262 352)">${melon()}</g>
  ${headline(SITE_NAME, 500, 330, 158)}
  ${tagline('每日最新吃瓜爆料速递', 486, 432)}`);
}

function channelSvg(name, sub) {
  const chars = Array.from(SITE_NAME);
  const brandHead = chars.slice(0, -2).join('');
  const brandTail = chars.slice(-2).join('');
  // channel names are 4 chars today; shrink a little for longer ones so they stay inside the canvas
  const size = Math.min(150, Math.floor(640 / Math.max(4, Array.from(name).length)));
  return frame(`
  <g transform="translate(250 360) scale(0.9)">${melon()}</g>
  <text x="492" y="170" font-family="${FONT}" font-weight="700" font-size="46" fill="${INK}" letter-spacing="3">${esc(brandHead)}</text>
  <rect x="${492 + Array.from(brandHead).length * 49 + 12}" y="126" width="${Array.from(brandTail).length * 47 + 22}" height="58" rx="6" fill="${RED}"/>
  <text x="${492 + Array.from(brandHead).length * 49 + 23}" y="169" font-family="${FONT}" font-weight="700" font-size="42" fill="#ffffff" letter-spacing="3">${esc(brandTail)}</text>
  ${headline(name, 494, 362, size)}
  ${tagline(sub, 486, 452, 38)}`);
}

/** Short tagline for a channel: the part of its description before the colon, if short enough. */
function channelSub(c) {
  const lead = (c.description ?? '').split(/[：:]/)[0].trim();
  const n = Array.from(lead).length;
  return n >= 4 && n <= 10 ? lead : `${c.name}最新爆料`;
}

async function render(svg, file) {
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9, palette: true, quality: 90 }).toFile(file);
  return file;
}

async function main() {
  const res = await fetch(`${STRAPI}/api/channels?pagination[pageSize]=100&sort=order:asc`);
  if (!res.ok) throw new Error(`fetch channels failed: HTTP ${res.status}`);
  const channels = ((await res.json()).data ?? []).filter((c) => c.slug && c.name);

  const outDir = path.join(WEB, 'public/og');
  await mkdir(outDir, { recursive: true });

  await render(homeSvg(), path.join(outDir, 'home.png'));
  console.log('home.png');
  for (const c of channels) {
    await render(channelSvg(c.name, channelSub(c)), path.join(outDir, `channel-${c.slug}.png`));
    console.log(`channel-${c.slug}.png  (${c.name} / ${channelSub(c)})`);
  }

  const manifest = { channels: channels.map((c) => c.slug).sort() };
  await writeFile(path.join(WEB, 'lib/og-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`og-manifest.json: ${manifest.channels.length} channels`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
