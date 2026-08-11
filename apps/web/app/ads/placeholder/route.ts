import { adFormatSpec, formatForSlot, AD_SLOT_ENTRIES } from '@/lib/adFormats';
import type { AdFormat } from 'shared';

/**
 * 广告展位图（演示用）：/ads/placeholder?slot=home-top&v=2
 *
 * 按位置 key 查出标准尺寸，现场生成一张同比例 SVG，零素材、改尺寸不用重做图。
 * v（第几张创意）决定配色 —— 同一位置排多张时肉眼可分辨轮播确实在换图。
 * 只在「无真实创意」的演示场景下被引用，不参与真实投放。
 */

/** 展位图配色：低饱和，一眼看得出是占位而非成品创意。 */
const PALETTE = [
  { bg: '#fdf1f1', ink: '#c1272d', line: '#e8b4b6' }, // 品牌红
  { bg: '#eef4fd', ink: '#2563a8', line: '#b3cbe8' }, // 蓝
  { bg: '#eefaf3', ink: '#1f8a5a', line: '#a9dcc3' }, // 绿
  { bg: '#fdf6ec', ink: '#b7791f', line: '#e6cfa3' }, // 琥珀
  { bg: '#f4f0fb', ink: '#6b46c1', line: '#cfc0ea' }, // 紫
];

/** SVG 文本里的 XML 特殊字符必须转义，否则 slot 名带 & 会直接把文档弄坏。 */
function esc(s: string): string {
  return s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * 粗估一行文字占几个 em：中日韩字符约 1em，其余（拉丁/数字/标点）约 0.55em。
 * SVG 里没法真正测量文本，靠它把字号收敛到「不溢出容器」——宁可偏小。
 */
function widthEm(s: string): number {
  let n = 0;
  for (const ch of s) n += ch.charCodeAt(0) > 0x2e80 ? 1 : 0.55;
  return Math.max(n, 1);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  // slot 来自 URL，先收窄字符集与长度再入 SVG（转义之外的第二道）。
  const slot = (url.searchParams.get('slot') ?? 'demo').replace(/[^a-z0-9_-]/gi, '').slice(0, 40);
  const variant = Math.min(Math.max(Number(url.searchParams.get('v') ?? 1) || 1, 1), 99);
  const fmtParam = url.searchParams.get('format') as AdFormat | null;

  const spec = adFormatSpec(formatForSlot(slot, fmtParam));
  const { width: w, height: h } = spec;
  const c = PALETTE[(variant - 1) % PALETTE.length];

  const base = Math.min(w, h);
  const pad = Math.max(4, Math.round(base * 0.04));
  const stripe = Math.max(10, Math.round(base * 0.06));
  const inner = w - pad * 4; // 文字可用宽度（两侧各留边框+呼吸位）

  // 矮条（anchor 320×50）塞不下两行，压成一行。
  const oneLine = h < 70;
  const where = AD_SLOT_ENTRIES[slot]?.where;

  const line1 = oneLine ? `${slot} · 示例创意 ${variant} · ${w}×${h}` : spec.label;
  const line2 = `${slot} · 示例创意 ${variant}`;
  const line3 = !oneLine && where && h >= 200 ? where : '';

  // 字号取「按宽度能放下」与「按高度不挤」两者的小值 —— 728×90 这种扁横幅不再出蚂蚁字，
  // 300×250 这种窄块也不会撑出容器。
  const byWidth = ((inner / widthEm(line1)) * 7) / 10;
  const byHeight = oneLine ? h * 0.5 : h * 0.3;
  const fs1 = Math.round(Math.max(11, Math.min(byWidth, byHeight)));
  const fs2 = Math.round(
    Math.max(10, Math.min(fs1 * 0.72, ((inner / widthEm(line2)) * 7) / 10, h * 0.2)),
  );

  const body = oneLine
    ? `<text x="${w / 2}" y="${h / 2}" fill="${c.ink}" font-size="${fs1}" font-weight="600"
    text-anchor="middle" dominant-baseline="central">${esc(line1)}</text>`
    : `<text x="${w / 2}" y="${h / 2 - fs2 * 0.7}" fill="${c.ink}" font-size="${fs1}" font-weight="700"
    text-anchor="middle" dominant-baseline="central">${esc(line1)}</text>
  <text x="${w / 2}" y="${h / 2 + fs1 * 0.7}" fill="${c.ink}" font-size="${fs2}" opacity="0.75"
    text-anchor="middle" dominant-baseline="central">${esc(line2)}</text>
  ${
    line3
      ? `<text x="${w / 2}" y="${h / 2 + fs1 * 0.7 + fs2 * 1.7}" fill="${c.ink}" font-size="${Math.round(
          Math.max(9, Math.min(fs2 * 0.85, ((inner / widthEm(line3)) * 7) / 10)),
        )}" opacity="0.55"
    text-anchor="middle" dominant-baseline="central">${esc(line3)}</text>`
      : ''
  }`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"
  role="img" aria-label="${esc(`广告展位图 ${slot}`)}"
  font-family="PingFang SC, Hiragino Sans GB, Microsoft YaHei, system-ui, sans-serif">
  <defs>
    <pattern id="p" width="${stripe * 2}" height="${stripe * 2}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="${stripe}" height="${stripe * 2}" fill="${c.line}" opacity="0.28"/>
    </pattern>
  </defs>
  <rect width="${w}" height="${h}" fill="${c.bg}"/>
  <rect width="${w}" height="${h}" fill="url(#p)"/>
  <rect x="${pad / 2}" y="${pad / 2}" width="${w - pad}" height="${h - pad}" fill="none"
    stroke="${c.ink}" stroke-opacity="0.45" stroke-width="${Math.max(1, Math.round(base * 0.012))}"
    stroke-dasharray="${stripe} ${Math.round(stripe * 0.6)}" rx="${Math.min(8, pad)}"/>
  ${body}
  ${
    oneLine
      ? '' /* 矮条正文里已经带了尺寸，再放角标会撞在一起 */
      : `<text x="${pad + 2}" y="${pad + fs2}" fill="${c.ink}" font-size="${Math.round(fs2 * 0.9)}" opacity="0.7"
    font-weight="600">${w}×${h}</text>`
  }
</svg>`;

  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      // 内容只取决于 slot+v，永不变 → 长缓存。
      'Cache-Control': 'public, max-age=31536000, immutable',
      // 演示素材不该被搜索引擎收录。
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
