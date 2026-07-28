#!/usr/bin/env node
/**
 * 给无封面的已发布文章补品牌标题卡（scripts/hot-sync/backfill-cover.mjs）。
 *
 * 为什么需要：60s API 的微博端点只返回 title/hot_value/link，没有图片字段，
 * 纯微博来源的选题从一开始就无图可采。2026-07-28 统计：318 篇已发布文章中
 * 81 篇（25.5%）无封面，其中 90% 出自微博热搜，且仍在持续产生。
 *
 * 不去图库抓真人照片——本站写真实人物，来源不明的配图既有版权风险也有张冠李戴风险。
 * 标题卡是自有内容，零风险且每篇不同。图由 gen_cover.py 渲染（1200×675，满足
 * Google Discover 封面宽度要求）。
 *
 * 用法：node backfill-cover.mjs [--limit 10] [--dry-run]
 */
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const DIR = dirname(fileURLToPath(import.meta.url));

for (const line of readFileSync(join(DIR, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].trim();
}
const API = process.env.STRAPI_API_URL || 'http://127.0.0.1:1337';
const TOKEN = process.env.STRAPI_API_TOKEN;

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const LIMIT = Number(arg('limit', 200));
const DRY = argv.includes('--dry-run');

async function api(path, opts = {}) {
  const res = await fetch(`${API}/api${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const json = res.status === 204 ? {} : await res.json();
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(json.error || json).slice(0, 160)}`);
  return json;
}

/** 调 gen_cover.py 渲染标题卡，返回本地文件路径 */
function renderCard(title, out, channel) {
  return new Promise((resolve, reject) => {
    const p = spawn('python3', [join(DIR, 'gen_cover.py'), title, out, channel || ''], { cwd: DIR });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (c) => (c === 0 ? resolve(out) : reject(new Error(`gen_cover 退出码 ${c}: ${err.slice(0, 200)}`))));
  });
}

/** 上传到 Strapi 媒体库（走 R2），带 alt 文本 */
async function upload(file, name, alt) {
  const form = new FormData();
  form.append('files', new Blob([readFileSync(file)], { type: 'image/jpeg' }), `${name}.jpg`);
  form.append('fileInfo', JSON.stringify({ alternativeText: alt, caption: alt }));
  const res = await fetch(`${API}/api/upload`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: form,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`upload ${res.status}: ${JSON.stringify(json.error || '').slice(0, 140)}`);
  return json[0]?.id ?? null;
}

async function main() {
  const q = '/articles?status=published&filters[cover][id][$null]=true'
    + '&fields[0]=title&fields[1]=slug&populate[channel][fields][0]=name'
    + '&populate[channel][fields][1]=slug&sort=createdAt:desc&pagination[pageSize]=100';
  const all = [];
  for (let page = 1; page <= 5; page++) {
    const r = await api(`${q}&pagination[page]=${page}`);
    all.push(...(r.data || []));
    if (page >= (r.meta?.pagination?.pageCount || 1)) break;
  }
  const todo = all.slice(0, LIMIT);
  console.log(`[scan] 无封面已发布文章 ${all.length} 篇，本次处理 ${todo.length} 篇${DRY ? '（dry-run）' : ''}`);

  let ok = 0, fail = 0;
  for (const a of todo) {
    const tmp = join(tmpdir(), `cover-${a.slug}.jpg`);
    try {
      await renderCard(a.title, tmp, a.channel?.name || '');
      if (DRY) {
        console.log(`[dry] ${a.slug} ← 「${a.title.slice(0, 26)}」`);
        ok += 1;
        continue;
      }
      const id = await upload(tmp, `cover-${a.slug}`, a.title);
      if (!id) throw new Error('upload 未返回 id');
      await api(`/articles/${a.documentId}?status=published`, {
        method: 'PUT', body: JSON.stringify({ data: { cover: id } }),
      });
      console.log(`[fix] /${a.channel?.slug}/${a.slug}`);
      ok += 1;
    } catch (e) {
      console.warn(`[warn] ${a.slug} 失败: ${e.message}`);
      fail += 1;
    } finally {
      if (existsSync(tmp)) unlinkSync(tmp);
    }
  }
  console.log(`[done] 成功 ${ok} 篇，失败 ${fail} 篇`);
}

main().catch((e) => { console.error('[fail]', e.message); process.exit(1); });
