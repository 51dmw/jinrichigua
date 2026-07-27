#!/usr/bin/env node
/**
 * 存量文章 SEO 修复（scripts/hot-sync/repair.mjs）
 *
 * 依据 docs/seo-training/notes/p108.md《内容修复方案》：目标不是把文章写长，
 * 而是让已发布内容具备结构、可被理解、可持续获得推荐。
 *
 * 两个阶段，刻意分开——能不调 LLM 的绝不调，省下配额给产稿：
 *   phase a（零 LLM，可全量跑）：
 *     · metaDescription 补到 120~160 字（现状 100% 短于 120，均值 58）
 *     · 正文补 2~3 条站内内链（现状 0/252 篇有内链）
 *   phase b（每篇 1 次 LLM，分批跑）：
 *     · 给没有小标题的正文加 ## 小标题
 *     · 去掉「你怎么看」式套话收尾
 *     · 事实纪律：只做结构化与去套话，不得增删或改动任何事实
 *
 * 写入只经 Strapi REST（PUT ?status=published 会同时更新草稿与已发布两行）。
 *
 * 用法：node repair.mjs --phase a [--limit 50] [--dry-run]
 *      node repair.mjs --phase b --limit 10 [--dry-run]
 */
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const file = join(DIR, '.env');
  if (!existsSync(file)) throw new Error('缺少 scripts/hot-sync/.env');
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#') && m[2] !== '' && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}
loadEnv();

const API = process.env.STRAPI_API_URL || 'http://127.0.0.1:1337';
const TOKEN = process.env.STRAPI_API_TOKEN;
const MODEL = process.env.CLAUDE_MODEL || 'sonnet';
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const PHASE = arg('phase', 'a');
const LIMIT = Number(arg('limit', 50));
const DRY = argv.includes('--dry-run');

const DESC_MIN = 120;
const DESC_MAX = 160;
const LINKS_TARGET = 3;

async function api(path, opts = {}) {
  const res = await fetch(`${API}/api${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const json = res.status === 204 ? {} : await res.json();
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(json.error || json).slice(0, 160)}`);
  return json;
}

async function fetchAll(path, extra = '') {
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const r = await api(`${path}?pagination[page]=${page}&pagination[pageSize]=100${extra}`);
    out.push(...(r.data || []));
    if (page >= (r.meta?.pagination?.pageCount || 1)) break;
  }
  return out;
}

/** 去掉 markdown 标记，取纯文本（用于生成描述） */
function plain(md) {
  return String(md || '')
    .replace(/^#+\s*/gm, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 生成 120~160 字描述：优先用 summary 起头，再从正文续接，按句号断句。
 * 不调 LLM——描述本质是正文首要信息的浓缩，截取即可，没必要花配额。
 */
function buildDescription(summary, content) {
  const parts = plain(`${summary || ''} ${plain(content).slice(0, 800)}`);
  if (parts.length <= DESC_MAX) return parts;

  // 断句要同时认全角和半角——存量文章大量使用半角 ?, 只认全角会把整段当成一句然后硬截
  const segs = parts.split(/(?<=[。！？；!?;])/).map((s) => s.trim()).filter(Boolean);
  let out = '';
  for (const seg of segs) {
    if (out.length + seg.length > DESC_MAX) break;
    // summary 常是正文首段的浓缩，两者拼在一起会出现同一句话说两遍——重复的跳过
    if (out && seg.length > 10 && out.includes(seg.slice(0, 10))) continue;
    out += seg;
    if (out.length >= DESC_MIN) break; // 已达标且落在句末，收工
  }
  if (out.length >= DESC_MIN) return out;

  // 完整句子拼不到 120 字：补到最近的一个逗号/顿号停顿处，别停在词中间
  const rest = parts.slice(out.length, DESC_MAX);
  const cut = Math.max(rest.lastIndexOf('，'), rest.lastIndexOf(','), rest.lastIndexOf('、'));
  return (out + (cut > 0 ? rest.slice(0, cut) : rest)).trim();
}

/** 描述是否合格：够长 + 结束在句末标点（半途截断的旧描述要重做） */
function descOk(d) {
  return String(d || '').length >= DESC_MIN && /[。！？!?]$/.test(String(d).trim());
}

function countLinks(content) {
  return [...String(content || '').matchAll(/\]\((\/[^)\s]+)\)/g)].length;
}

function callClaude(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p', '--model', MODEL], {
      cwd: DIR, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ANTHROPIC_API_KEY: '' },
    });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('claude -p 超时')); }, 300000);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (c) => { clearTimeout(timer); c === 0 ? resolve(out) : reject(new Error(`claude exit ${c}: ${err.slice(0, 200)}`)); });
    child.stdin.write(prompt); child.stdin.end();
  });
}

const REPAIR_PROMPT = (a) => `你在修复一篇已发布的资讯文章的**结构**，不是重写它。

原标题：${a.title}
原正文：
"""
${a.content}
"""

【铁律】
- 不得增加、删除或改动任何事实信息（人名、数字、时间、机构、说法、结论一律照旧）
- 不得改变事件本身，也不得补充原文没有的细节
- 保留原有的段落顺序和信息密度，这不是扩写

【要做的事】
1. 在合适位置插入 3~5 个「## 小标题」，把长段落切成有结构的小节；小标题要具体（写清这一节讲什么），不要用「事件梳理」「网友讨论」这类通用词
2. 如果结尾是向读者提问（「你怎么看」「你觉得呢」「评论区聊聊」之类），改写成陈述式收尾：写清目前进展、还没有定论的部分，或已确定与未确定的区分。不要提问
3. 删除明显的套话：「不仅…而且」「值得注意的是」「总的来说」「先来梳理一下」「本文」「小编」

只输出修复后的正文 markdown，不要任何解释、不要代码块围栏、不要标题行。`;

async function main() {
  console.log(`[repair] phase=${PHASE} limit=${LIMIT} dry=${DRY}`);
  const arts = await fetchAll('/articles',
    '&sort=publishAt:desc&fields[0]=title&fields[1]=slug&fields[2]=summary&fields[3]=content'
    + '&populate[channel][fields][0]=slug&populate[seo][fields][0]=metaTitle&populate[seo][fields][1]=metaDescription&populate[seo][fields][2]=keywords');
  console.log(`[repair] 已发布文章 ${arts.length} 篇`);

  // 同频道候选，供补内链用
  const byChannel = new Map();
  for (const a of arts) {
    const ch = a.channel?.slug;
    if (!ch || !a.slug) continue;
    if (!byChannel.has(ch)) byChannel.set(ch, []);
    byChannel.get(ch).push({ title: a.title, path: `/${ch}/${a.slug}`, documentId: a.documentId });
  }

  let done = 0, skipped = 0;
  for (const a of arts) {
    if (done >= LIMIT) break;
    const patch = {};
    const notes = [];

    if (PHASE === 'a') {
      const desc = a.seo?.metaDescription || '';
      if (!descOk(desc)) {
        const next = buildDescription(a.summary, a.content);
        if (descOk(next) || next.length >= DESC_MIN) {
          patch.seo = { metaTitle: a.seo?.metaTitle || a.title.slice(0, 60), metaDescription: next, keywords: a.seo?.keywords || '' };
          notes.push(`描述 ${desc.length}→${next.length} 字`);
        }
      }
      if (countLinks(a.content) === 0) {
        const pool = (byChannel.get(a.channel?.slug) || []).filter((x) => x.documentId !== a.documentId);
        const picks = pool.slice(0, LINKS_TARGET);
        if (picks.length >= 2) {
          patch.content = `${a.content}\n\n## 相关阅读\n\n${picks.map((p) => `- [${p.title}](${p.path})`).join('\n')}`;
          notes.push(`补内链 ${picks.length} 条`);
        }
      }
    } else {
      // 阶段 a 会在文末追加「## 相关阅读」，它不算正文结构——判断前先切掉
      const bodyOnly = String(a.content || '').split(/\n##+ 相关阅读/)[0];
      const hasHeads = (bodyOnly.match(/^##+ /gm) || []).length >= 2;
      const hasQuestionEnd = /(你怎么看|你觉得呢|你怎么想|评论区(聊聊|见|等你|说说)|欢迎留言)/.test(a.content || '');
      if (!hasHeads || hasQuestionEnd) {
        const fixed = (await callClaude(REPAIR_PROMPT(a))).replace(/```[a-z]*\n?/g, '').trim();
        // 安全阀：结构修复不该让正文大幅缩水，缩水超过 15% 视为模型跑偏，弃用
        if (fixed.length < a.content.length * 0.85) {
          console.warn(`  ✗ ${a.slug} 修复后从 ${a.content.length} 缩到 ${fixed.length} 字，疑似改写过度，跳过`);
          skipped += 1;
          continue;
        }
        // 保住阶段 a 已经补上的内链
        patch.content = countLinks(a.content) > 0 && countLinks(fixed) === 0
          ? `${fixed}\n\n${a.content.slice(a.content.lastIndexOf('## 相关阅读'))}`
          : fixed;
        notes.push(`${hasHeads ? '' : '补小标题 '}${hasQuestionEnd ? '去提问收尾' : ''}`.trim());
      }
    }

    if (!Object.keys(patch).length) { skipped += 1; continue; }
    if (DRY) {
      console.log(`[dry] ${a.slug} → ${notes.join('、')}`);
    } else {
      await api(`/articles/${a.documentId}?status=published`, { method: 'PUT', body: JSON.stringify({ data: patch }) });
      console.log(`[fix] ${a.slug} → ${notes.join('、')}`);
    }
    done += 1;
  }
  console.log(`[done] 修复 ${done} 篇，跳过 ${skipped} 篇（已合格或无需处理）`);
}

main().catch((e) => { console.error(`[fatal] ${e.message}`); process.exitCode = 1; });
