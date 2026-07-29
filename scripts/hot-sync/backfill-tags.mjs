#!/usr/bin/env node
/**
 * 标题实体标签回填（scripts/hot-sync/backfill-tags.mjs）
 *
 * 背景：clean-tags.mjs 解决的是「标签侧」——空标签、近义分裂、标签名字面能匹配上的回填。
 * 但字面匹配到头之后还剩一个更大的缺口在「文章侧」：
 *   384 篇里 72 篇的标签全是泛词（热搜/网络热议/吃瓜/围观），一个具体标签都没有；
 *   另有 129 篇只有 1 个具体标签。
 *   例：「那英怼冉莹颖档案」只挂了 明星/热搜/网络热议/娱乐八卦，没有「那英」「冉莹颖」。
 * 这类要从标题里抽实体（人名/作品/机构/赛事），字面规则做不到，得过一遍模型。
 *
 * 防孤岛的关键约束：抽出来的候选标签，只有满足下面之一才会被采用——
 *   ① 站内已经存在这个标签（直接复用）
 *   ② 它在全站标题里覆盖 >= MIN_ARTICLES 篇（才允许新建）
 * 也就是说新建的标签一诞生就至少挂着 2 篇，不会再产生 1 篇的孤岛
 * （这正是 clean-tags.mjs 刚清理掉的那类）。
 *
 * 写入只经 Strapi REST（PUT ?status=published 同时更新草稿与已发布两行）。
 *
 * 用法：
 *   node backfill-tags.mjs                 # 只报告（默认）
 *   node backfill-tags.mjs --apply         # 执行回填
 *   node backfill-tags.mjs --limit 80      # 只处理前 N 篇（试水用）
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const CACHE = join(DIR, '.backfill-cache.json');

function loadEnv() {
  const file = join(DIR, '.env');
  if (!existsSync(file)) throw new Error('缺少 scripts/hot-sync/.env');
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#') && m[2] !== '' && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}
loadEnv();
const URL_BASE = process.env.STRAPI_API_URL || 'http://127.0.0.1:1337';
const TOKEN = process.env.STRAPI_API_TOKEN;
const MODEL = process.env.CLAUDE_MODEL || 'sonnet';
if (!TOKEN) throw new Error('.env 缺 STRAPI_API_TOKEN');

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const LIMIT = Number((argv[argv.indexOf('--limit') + 1] || 0)) || 0;

const BATCH = 30;            // 每次喂给模型的标题数
const MIN_ARTICLES = 2;      // 新建标签的最低覆盖篇数——低于它宁可不建
const MAX_TAGS_PER_ART = 5;  // 与管线一致：每篇最多 5 个标签

// 泛词：这些已经挂得到处都是，不需要模型再产出
const GENERIC = new Set(['热搜', '网络热议', '吃瓜', '围观', '出圈', '反转', '大瓜', '黑料', '实锤',
  '爆料', '视频', '微博热搜', '热榜', '娱乐八卦', '明星', '冲突', '塌房', '顶流', '赛后', '网红']);

async function api(path, opts = {}) {
  const res = await fetch(`${URL_BASE}/api${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${path} ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? null : res.json();
}

async function allPages(path) {
  const out = [];
  for (let p = 1; p < 60; p++) {
    const j = await api(`${path}${path.includes('?') ? '&' : '?'}pagination[page]=${p}&pagination[pageSize]=100`);
    const d = j.data || [];
    out.push(...d);
    if (d.length < 100) break;
  }
  return out;
}

// 刻意用 --disallowedTools 关掉工具：这个子进程只需要产出 JSON，不需要碰文件系统。
// （index.mjs 的 callClaude 以仓库目录为 cwd 且带工具权限，实跑中出现过它跑去读
//  index.mjs 源码、把代码分析当成文章正文吐出来的情况。新脚本不重复这个坑。）
function callClaude(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p', '--model', MODEL, '--disallowedTools', 'Bash,Read,Write,Edit,Glob,Grep,WebFetch,WebSearch'], {
      cwd: tmpCwd(), stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ANTHROPIC_API_KEY: '' },
    });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('claude -p 超时(300s)')); }, 300000);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error(`claude exit ${code}: ${err.slice(0, 200)}`)); });
    child.stdin.end(prompt);
  });
}
// 在空目录里跑，进一步断掉它「顺手读仓库」的可能
let _tmp = null;
function tmpCwd() {
  if (!_tmp) {
    _tmp = join(process.env.TMPDIR || '/tmp', `bft-${process.pid}`);
    try { mkdirSync(_tmp, { recursive: true }); } catch { /* 已存在即可 */ }
  }
  return _tmp;
}

function parseJson(text) {
  const s = text.indexOf('[');
  const e = text.lastIndexOf(']');
  if (s < 0 || e < s) throw new Error('输出不含 JSON 数组');
  return JSON.parse(text.slice(s, e + 1));
}

function prompt(items, tagLib) {
  return `你在给一个中文吃瓜资讯站做标签标注。下面每行是一篇文章的编号和标题。

${items.map((a, i) => `${i}. ${a.title}`).join('\n')}

为每篇抽出 1~3 个**具体**标签，规则：
- 只抽标题里明确出现的实体：人名、作品名、机构/品牌、赛事、具体事件主题
- 不要输出这些泛词（站内已经泛滥）：${[...GENERIC].join('、')}
- 优先复用下面已有标签，字要完全一致：
${tagLib.join('、')}
- 人名就写人名本身（如「那英」「冉莹颖」），不要写成「那英争议」
- 作品名不带书名号（写「年会不能停2」不写「《年会不能停2》」）
- 标题里没有具体实体的（纯泛论），tags 给空数组，不要硬凑

只输出 JSON 数组，不要任何其他文字：
[{"i":编号,"tags":["标签1","标签2"]}]`;
}

async function main() {
  console.log(`[backfill-tags] ${APPLY ? '执行模式' : '报告模式（不写入，加 --apply 才执行）'}\n`);

  const tags = (await allPages('/tags?fields[0]=name&populate[articles][count]=true'))
    .map((t) => ({ name: t.name, doc: t.documentId, n: t.articles?.count ?? 0 }));
  const byName = new Map(tags.map((t) => [t.name, t]));
  const tagLib = tags.filter((t) => !GENERIC.has(t.name)).sort((a, b) => b.n - a.n).map((t) => t.name);

  let arts = (await allPages('/articles?status=published&fields[0]=title&populate[tags][fields][0]=name'))
    .map((a) => ({ doc: a.documentId, title: a.title, tags: (a.tags || []).map((x) => x.name), pairs: (a.tags || []).map((x) => ({ name: x.name, id: x.documentId })) }));
  if (LIMIT) arts = arts.slice(0, LIMIT);
  console.log(`文章 ${arts.length} 篇，现有标签 ${tags.length} 个（喂给模型的复用词表 ${tagLib.length} 个）`);

  // 抽取结果做缓存：模型调用慢，报告→执行两趟不必重跑
  let cache = {};
  try { cache = JSON.parse(readFileSync(CACHE, 'utf8')); } catch { /* 首次运行没有缓存 */ }

  const todo = arts.filter((a) => !cache[a.doc]);
  console.log(`需要抽取 ${todo.length} 篇（缓存命中 ${arts.length - todo.length} 篇）\n`);

  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    process.stdout.write(`  抽取 ${i + 1}~${i + batch.length}/${todo.length} … `);
    try {
      const out = parseJson(await callClaude(prompt(batch, tagLib)));
      for (const r of out) {
        const a = batch[r.i];
        if (!a) continue;
        cache[a.doc] = (r.tags || []).map((s) => String(s).trim()).filter((s) => s && s.length <= 12 && !GENERIC.has(s));
      }
      // 没被模型提到的补空数组，避免下一轮重复抽
      for (const a of batch) if (!cache[a.doc]) cache[a.doc] = [];
      writeFileSync(CACHE, JSON.stringify(cache));
      console.log('ok');
    } catch (e) {
      console.log(`失败（跳过）: ${e.message.slice(0, 60)}`);
    }
  }

  // ---------- 统计候选覆盖度，决定哪些能新建 ----------
  const cover = new Map(); // 标签名 → 篇数
  for (const a of arts) for (const t of new Set(cache[a.doc] || [])) cover.set(t, (cover.get(t) || 0) + 1);

  const usable = new Set();
  const newTags = [];
  for (const [name, n] of cover) {
    if (byName.has(name)) { usable.add(name); continue; }      // 已存在，直接复用
    if (n >= MIN_ARTICLES) { usable.add(name); newTags.push({ name, n }); }  // 够覆盖，允许新建
  }
  const dropped = [...cover.entries()].filter(([n]) => !usable.has(n));

  console.log(`\n候选标签 ${cover.size} 个：可复用已有 ${usable.size - newTags.length} 个，`
    + `新建 ${newTags.length} 个（覆盖 >= ${MIN_ARTICLES} 篇），`
    + `丢弃 ${dropped.length} 个（只够 1 篇，建了就是孤岛）`);
  if (newTags.length) {
    console.log(`  将新建：${newTags.sort((a, b) => b.n - a.n).map((t) => `${t.name}(${t.n})`).join('、')}`);
  }

  // ---------- 计算每篇要补的标签 ----------
  // 位置不够时挤掉泛词给具体标签让位：泛词已经挂得到处都是（网络热议 279 篇、
  // 热搜 185 篇），少一篇毫无损失；而「迪丽热巴」「赵雅芝」这种才撑得起聚合页。
  // 不这么做的话，标签虽然按「覆盖 >= 2 篇」建了出来，却因为目标文章标签位已满
  // 而实际只挂上 1 篇，反倒制造出新孤岛（首次跑 44 个新标签里有 17 个栽在这）。
  const plan = [];
  for (const a of arts) {
    const want = [...new Set(cache[a.doc] || [])].filter((t) => usable.has(t) && !a.tags.includes(t));
    if (!want.length) continue;
    const room = MAX_TAGS_PER_ART - a.tags.length;
    let evict = [];
    if (want.length > room) {
      // 只挤泛词，且至少给文章留 1 个泛词（保留一点大类可浏览性）
      const gen = a.pairs.filter((p) => GENERIC.has(p.name));
      evict = gen.slice(0, Math.max(0, Math.min(gen.length - 1, want.length - room)));
    }
    const add = want.slice(0, room + evict.length);
    if (!add.length) continue;
    plan.push({ ...a, add, evict });
  }
  const evicting = plan.filter((p) => p.evict.length).length;
  console.log(`\n待回填 ${plan.length} 篇（其中 ${evicting} 篇标签位已满，将挤掉泛词让位）：`);
  plan.slice(0, 12).forEach((p) => console.log(`   · ${p.title.slice(0, 34)}  +[${p.add.join(',')}]${p.evict.length ? ` -[${p.evict.map((e) => e.name).join(',')}]` : ''}`));
  if (plan.length > 12) console.log(`   · …另 ${plan.length - 12} 篇`);

  if (!APPLY) { console.log(`\n[done] 报告完毕，未写入。确认后加 --apply 执行。`); return; }

  // ---------- 新建标签 ----------
  for (const t of newTags) {
    try {
      const c = await api('/tags', { method: 'POST', body: JSON.stringify({ data: { name: t.name } }) });
      byName.set(t.name, { name: t.name, doc: c.data.documentId, n: 0 });
    } catch (e) { console.warn(`[warn] 建标签「${t.name}」失败: ${e.message.slice(0, 60)}`); }
  }

  // ---------- 回填 ----------
  let ok = 0;
  for (const p of plan) {
    const ids = p.add.map((n) => byName.get(n)?.doc).filter(Boolean);
    if (!ids.length) continue;
    const evictIds = new Set(p.evict.map((e) => e.id));
    const kept = p.pairs.filter((x) => !evictIds.has(x.id)).map((x) => x.id);
    try {
      await api(`/articles/${p.doc}?status=published`, { method: 'PUT', body: JSON.stringify({ data: { tags: [...kept, ...ids] } }) });
      ok += 1;
    } catch (e) { console.warn(`[warn] 《${p.title.slice(0, 20)}》失败: ${e.message.slice(0, 60)}`); }
  }
  console.log(`\n[done] 回填 ${ok}/${plan.length} 篇，新建标签 ${newTags.length} 个`);

  // 收尾：仍未达到 MIN_ARTICLES 的新标签删掉，守住「不留孤岛」的承诺
  const after = new Map((await allPages('/tags?fields[0]=name&populate[articles][count]=true'))
    .map((t) => [t.name, { n: t.articles?.count ?? 0, doc: t.documentId }]));
  let purged = 0;
  for (const t of newTags) {
    const cur = after.get(t.name);
    if (!cur || cur.n >= MIN_ARTICLES) continue;
    try { await api(`/tags/${cur.doc}`, { method: 'DELETE' }); purged += 1; console.log(`[purge] 「${t.name}」实际只挂到 ${cur.n} 篇，删除`); } catch { /* 删不掉留给 clean-tags */ }
  }
  if (purged) console.log(`[done] 清掉 ${purged} 个未达标的新标签`);
}

main().catch((e) => { console.error(`[fatal] ${e.message}`); process.exitCode = 1; });
