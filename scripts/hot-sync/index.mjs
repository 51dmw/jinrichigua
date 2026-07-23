#!/usr/bin/env node
/**
 * 热榜同步二创脚本（scripts/hot-sync）
 *
 * 管线：60s API 热榜同步 → LLM 选题(过滤时政敏感/合并跨榜同事件) → LLM 二创成文
 *      → 敏感词过滤 → Strapi REST 写入草稿(reviewState=pending) → 后台人工审核发布。
 *
 * 写入只经 Strapi REST API（符合 DEVELOPMENT_CONSTRAINTS §数据流约束），不直连数据库。
 * 生成后端可插拔：claude（默认，走本机 Claude Code Max 订阅）/ minimax（OpenAI 兼容，需余额）。
 *
 * 用法：node index.mjs [--limit 5] [--sources weibo,baidu,douyin,toutiao,zhihu] [--dry-run] [--backend claude|minimax]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(DIR, 'state.json');

// ---------- env ----------
function loadEnv() {
  const file = join(DIR, '.env');
  if (!existsSync(file)) throw new Error('缺少 scripts/hot-sync/.env（参照 .env.example）');
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#') && m[2] !== '' && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}
loadEnv();

const CFG = {
  strapiUrl: process.env.STRAPI_API_URL || 'http://127.0.0.1:1337',
  strapiToken: process.env.STRAPI_API_TOKEN,
  hotApiBase: process.env.HOT_API_BASE || 'https://60s-api.viki.moe/v2',
  backend: process.env.GEN_BACKEND || 'claude',
  claudeModel: process.env.CLAUDE_MODEL || 'sonnet',
  minimaxUrl: process.env.MINIMAX_API_URL || 'https://api.minimax.io/v1',
  minimaxKey: process.env.MINIMAX_API_KEY,
  minimaxModel: process.env.MINIMAX_MODEL || 'MiniMax-M2.7',
  wujiaiUrl: process.env.WUJIAI_API_URL || 'https://chat.wujiai.cloud/api/v1',
  wujiaiKey: process.env.WUJIAI_API_KEY,
  wujiaiModel: process.env.WUJIAI_MODEL || '无极AI',
};
if (!CFG.strapiToken) throw new Error('.env 缺 STRAPI_API_TOKEN');

// ---------- cli args ----------
const argv = process.argv.slice(2);
function arg(name, dflt) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
}
const LIMIT = Number(arg('limit', 5));
const DRY = argv.includes('--dry-run');
// 自动发布：默认开（.env AUTO_PUBLISH=0 或 --draft 关闭）；命中敏感词的文章仍留草稿人工审核
const AUTO_PUBLISH = !argv.includes('--draft') && (process.env.AUTO_PUBLISH ?? '1') !== '0';
const BACKEND = arg('backend', CFG.backend);
const SOURCE_KEYS = arg('sources', 'weibo,baidu,douyin,toutiao,zhihu').split(',').map((s) => s.trim());

// ---------- 热榜源适配（60s API，字段各端点不同） ----------
const SOURCES = {
  weibo:   { path: 'weibo',     name: '微博热搜', map: (i) => ({ title: i.title, heat: i.hot_value || 0, link: i.link || '', desc: '', cover: '' }) },
  baidu:   { path: 'baidu/hot', name: '百度热搜', map: (i) => ({ title: i.title, heat: Number(i.score) || 0, link: i.url || '', desc: i.desc || '', cover: i.cover || '' }) },
  douyin:  { path: 'douyin',    name: '抖音热点', map: (i) => ({ title: i.title, heat: i.hot_value || 0, link: i.link || '', desc: '', cover: i.cover || '' }) },
  toutiao: { path: 'toutiao',   name: '头条热榜', map: (i) => ({ title: i.title, heat: i.hot_value || 0, link: i.link || '', desc: '', cover: i.cover || '' }) },
  zhihu:   { path: 'zhihu',     name: '知乎热榜', map: (i) => ({ title: i.title, heat: 0, link: i.link || '', desc: (i.detail || '').slice(0, 120), cover: i.cover || '' }) },
};

async function fetchHotLists() {
  const all = [];
  await Promise.all(
    SOURCE_KEYS.map(async (key) => {
      const src = SOURCES[key];
      if (!src) return console.warn(`[warn] 未知源 ${key}，跳过`);
      try {
        const res = await fetch(`${CFG.hotApiBase}/${src.path}`, { signal: AbortSignal.timeout(15000) });
        const json = await res.json();
        if (json.code !== 200 || !Array.isArray(json.data)) throw new Error(`code=${json.code}`);
        for (const item of json.data.slice(0, 20)) all.push({ source: src.name, ...src.map(item) });
        console.log(`[sync] ${src.name}: ${Math.min(json.data.length, 20)} 条`);
      } catch (e) {
        console.warn(`[warn] ${src.name} 拉取失败: ${e.message}`);
      }
    })
  );
  return all;
}

// ---------- 去重状态 ----------
function loadState() {
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { return { done: {} }; }
}
function fingerprint(title) {
  return title.replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase().slice(0, 40);
}

// ---------- LLM 后端 ----------
function callClaude(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p', '--model', CFG.claudeModel], {
      cwd: DIR, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ANTHROPIC_API_KEY: '' }, // 强制走订阅登录态而非 API key
    });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('claude -p 超时(300s)')); }, 300000);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => {
      clearTimeout(timer);
      code === 0 ? resolve(out) : reject(new Error(`claude exit ${code}: ${err.slice(0, 300)}`));
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// OpenAI 兼容后端（minimax / wujiai 共用）。注意 wujiai WAF 拦含 "OpenAI/J" 的 UA，统一伪装 openai-python。
async function callOpenAICompat({ url, key, model, name }, prompt) {
  if (!key) throw new Error(`.env 缺 ${name.toUpperCase()}_API_KEY`);
  const res = await fetch(`${url}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'User-Agent': 'openai-python/1.0.0' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: 8192 }),
    signal: AbortSignal.timeout(240000), // minimax/wujiai 服务端响应都可能波动，给长超时（见运维记录）
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${name} ${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
  return json.choices[0].message.content;
}

const OPENAI_BACKENDS = {
  minimax: () => ({ url: CFG.minimaxUrl, key: CFG.minimaxKey, model: CFG.minimaxModel, name: 'minimax' }),
  wujiai: () => ({ url: CFG.wujiaiUrl, key: CFG.wujiaiKey, model: CFG.wujiaiModel, name: 'wujiai' }),
};

// 调 LLM 并解析 JSON；调用失败或 JSON 解析失败都算失败，整体重试（LLM 输出不稳定，重试通常能过）。
// 解析失败先走一次「修复」：把坏输出发回 LLM 修成合法 JSON（引号/换行转义是高频病灶，重写不如修）。
async function llmJSON(prompt, label) {
  const fn = OPENAI_BACKENDS[BACKEND] ? (p) => callOpenAICompat(OPENAI_BACKENDS[BACKEND](), p) : callClaude;
  for (let i = 1; i <= 3; i++) {
    try {
      const raw = await fn(prompt);
      try { return parseJSON(raw, label); } catch (pe) {
        console.warn(`[warn] ${label} 第${i}次输出非法 JSON（${pe.message.slice(0, 80)}），尝试修复`);
        const fixed = await fn(`以下文本是一段不合法的 JSON（字符串内可能有未转义的引号或换行）。修复转义使其成为合法 JSON，内容原样保留，只输出修复后的 JSON，不要任何其他文字：\n\n${raw}`);
        return parseJSON(fixed, `${label}(修复)`);
      }
    } catch (e) {
      console.warn(`[warn] ${label} 第${i}次失败: ${e.message.slice(0, 200)}`);
      if (i === 3) throw e;
    }
  }
}

function parseJSON(text, label) {
  const cleaned = text.replace(/```(?:json)?/g, '');
  const s = cleaned.indexOf('['), s2 = cleaned.indexOf('{');
  const start = s >= 0 && (s2 < 0 || s < s2) ? s : s2;
  const end = Math.max(cleaned.lastIndexOf(']'), cleaned.lastIndexOf('}'));
  if (start < 0 || end <= start) throw new Error(`${label} 输出不含 JSON: ${text.slice(0, 120)}`);
  return JSON.parse(cleaned.slice(start, end + 1));
}

// 采集素材封面图 → 传入 Strapi 媒体库（自存避免防盗链/签名过期）；失败返回 null，文章照常发只是无图
async function uploadCover(url, name) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15' },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`http ${res.status}`);
    const type = (res.headers.get('content-type') || 'image/jpeg').split(';')[0];
    if (!type.startsWith('image/')) throw new Error(`非图片: ${type}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 2048) throw new Error('图片过小，疑似防盗链占位');
    const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
    const form = new FormData();
    form.append('files', new Blob([buf], { type }), `${name}.${ext}`);
    const up = await fetch(`${CFG.strapiUrl}/api/upload`, {
      method: 'POST', headers: { Authorization: `Bearer ${CFG.strapiToken}` }, body: form,
    });
    const json = await up.json();
    if (!up.ok) throw new Error(`upload ${up.status}: ${JSON.stringify(json.error || '').slice(0, 100)}`);
    return json[0]?.id ?? null;
  } catch (e) {
    console.warn(`[warn] 封面采集失败(${e.message}): ${String(url).slice(0, 80)}`);
    return null;
  }
}

// ---------- Strapi REST ----------
async function strapi(path, opts = {}) {
  const res = await fetch(`${CFG.strapiUrl}/api${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${CFG.strapiToken}`, 'Content-Type': 'application/json', ...opts.headers },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Strapi ${opts.method || 'GET'} ${path} → ${res.status}: ${JSON.stringify(json.error || json).slice(0, 200)}`);
  return json;
}

async function fetchAllPages(path, qs = '') {
  const out = [];
  for (let page = 1; ; page++) {
    const json = await strapi(`${path}?pagination[page]=${page}&pagination[pageSize]=100${qs}`);
    out.push(...json.data);
    if (page >= (json.meta?.pagination?.pageCount || 1)) return out;
  }
}

// ---------- prompts ----------
const CHANNELS_DESC = [
  ['star', '明星娱乐（明星八卦/影视综艺）'], ['influencer', '网红达人（主播/博主/网红事件）'],
  ['video', '吃瓜视频（有视频画面感的热点）'], ['society', '社会大瓜（社会新闻类话题）'],
  ['inside', '爆料内幕（爆料/内幕/知情人说法）'], ['dirt', '黑料档案（人物争议/翻车合集）'],
  ['love', '情感婚恋（恋情/婚姻/情感纠纷）'], ['sports', '体育吃瓜（体育圈人物话题）'],
  ['campus', '校园热议（学校/学生/教育话题）'], ['oversea', '海外吃瓜（海外明星/海外热点）'],
  ['history', '历史旧瓜（旧闻回顾/往事盘点）'],
];

// 默认 prompt（单一事实来源在此；后台「热榜二创配置」字段为空时首跑会自动填入，之后以后台为准）
const DEFAULT_PICK_PROMPT = `你是吃瓜资讯站「今日吃瓜」的选题编辑。以下是当前各平台热榜（编号. [来源] 标题 | 热度 | 补充说明）：

{{topics}}

从中选出最多 {{limit}} 个适合本站的选题。硬性规则：
- 只选「吃瓜向」：明星/网红/影视综艺/社会趣闻/体育人物/海外热点/情感话题等大众娱乐谈资
- 必须排除：时政、政府政策、领导人、军事外交、民族宗教、重大灾难伤亡、疫情防控等严肃或敏感议题
- 同一事件在多个榜单出现的，合并为一个选题（refs 列出所有相关编号）
- 每个选题从以下频道中选最贴切的一个：
{{channels}}

只输出 JSON 数组，不要任何其他文字：
[{"topic":"选题概括(一句话)","angle":"吃瓜切入角度(一句话)","channelSlug":"频道slug","refs":[相关条目编号]}]`;

const DEFAULT_WRITE_PROMPT = `你是吃瓜资讯站「今日吃瓜」的编辑，为以下热点话题写一篇原创短资讯。

选题：{{topic}}
切入角度：{{angle}}
热榜素材（仅此为事实依据）：
{{refs}}

写作要求：
- 标题 ≤40 字，吸引点击但不夸张失实
- 正文 markdown，700~1200 字，移动端短段落；结构：开头钩子 → 事件梳理 → 网友讨论点 → 结尾抛一个互动问题
- 事实纪律（最重要）：只依据上面素材成文；素材没有的细节一律不得编造具体人名/数字/引语，用「据网友讨论」「网传消息称」等模糊表述；未证实信息必须标注「网传/尚未证实」；不诽谤不定罪，争议事件保持中立转述
- 语气轻松会聊天，像朋友间分享，但不低俗
- summary ≤120 字
- slug：英文小写连字符，2~3 个词，尽量短（SEO 用）
- tags：2~4 个，name 中文、slug 英文小写连字符。**必须优先从下面「可复用标签库」里选**，尽量全部命中；标签要用「可跨事件复用的话题词/品类词」(如 明星、恋情、塌房、综艺、体育)，**不要用一次性的具体人名或单一事件词做标签**(如 某某某、某活动名)——那会产生只有一篇的孤岛标签页。最多只允许出现 1 个库里没有的新标签，且该新标签也必须是能被后续文章复用的通用词。
  可复用标签库(优先复用)：{{taglib}}
- seo.metaTitle ≤60 字符；seo.metaDescription ≤150 字符；seo.keywords 逗号分隔 3~6 个中文词

只输出 JSON，不要任何其他文字。注意：content 里的换行必须转义为 \\n；标题和正文中一律使用中文引号「」或书名号《》，禁止出现英文双引号字符，确保整体是合法 JSON：
{"title":"...","slug":"...","summary":"...","content":"markdown正文","tags":[{"name":"...","slug":"..."}],"seo":{"metaTitle":"...","metaDescription":"...","keywords":"..."}}`;

function render(tpl, vars) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');
}

// 从后台「热榜二创配置」拉 prompt；字段为空则回填默认值（仅填空缺，不覆盖后台手改），读取失败回退内置
async function loadPrompts() {
  try {
    const res = await fetch(`${CFG.strapiUrl}/api/hot-sync-config`, {
      headers: { Authorization: `Bearer ${CFG.strapiToken}` },
    });
    const cfg = res.ok ? (await res.json()).data || {} : {};
    if (!res.ok && res.status !== 404) console.warn(`[warn] 后台 prompt 配置读取 ${res.status}（token 需勾选 hot-sync-config 的 find/update 权限），用内置默认`);
    const fill = {};
    if (!cfg.pickPrompt?.trim()) fill.pickPrompt = DEFAULT_PICK_PROMPT;
    if (!cfg.writePrompt?.trim()) fill.writePrompt = DEFAULT_WRITE_PROMPT;
    if (Object.keys(fill).length && res.status !== 403) {
      await strapi('/hot-sync-config', { method: 'PUT', body: JSON.stringify({ data: fill }) })
        .then(() => console.log(`[cfg] 默认 prompt 已回填后台（${Object.keys(fill).join('/')}）`))
        .catch((e) => console.warn(`[warn] 回填后台 prompt 失败: ${e.message.slice(0, 120)}`));
    }
    return {
      pick: cfg.pickPrompt?.trim() || DEFAULT_PICK_PROMPT,
      write: cfg.writePrompt?.trim() || DEFAULT_WRITE_PROMPT,
    };
  } catch (e) {
    console.warn(`[warn] 后台 prompt 配置读取失败，用内置默认: ${e.message}`);
    return { pick: DEFAULT_PICK_PROMPT, write: DEFAULT_WRITE_PROMPT };
  }
}

function pickPrompt(prompts, topics, n) {
  return render(prompts.pick, {
    topics: topics.map((t, i) => `${i}. [${t.source}] ${t.title} | ${t.heat || '-'} | ${t.desc || '-'}`).join('\n'),
    limit: String(n),
    channels: CHANNELS_DESC.map(([s, d]) => `  ${s}: ${d}`).join('\n'),
  });
}

function writePrompt(prompts, sel, refs, tagLib = []) {
  return render(prompts.write, {
    topic: sel.topic,
    angle: sel.angle,
    refs: refs.map((r) => `- [${r.source}] ${r.title}${r.desc ? `：${r.desc}` : ''}`).join('\n'),
    taglib: tagLib.join('、'),
  });
}

// ---------- main ----------
async function main() {
  // --init-config：只把默认 prompt 回填后台空字段后退出（不拉热榜不生成）
  if (argv.includes('--init-config')) {
    await loadPrompts();
    return console.log('[done] 后台 prompt 配置已就绪');
  }
  console.log(`[hot-sync] backend=${BACKEND} limit=${LIMIT} dry=${DRY} sources=${SOURCE_KEYS.join(',')}`);

  // 1. 同步热榜
  const topics = await fetchHotLists();
  if (!topics.length) throw new Error('所有热榜源都拉取失败');

  // 2. 去重（跑过的话题不再生成）
  const state = loadState();
  const fresh = topics.filter((t) => !state.done[fingerprint(t.title)]);
  console.log(`[dedup] ${topics.length} 条热榜 → ${fresh.length} 条新话题`);
  if (!fresh.length) return console.log('[done] 没有新话题');

  // 3. LLM 选题（prompt 优先取后台「热榜二创配置」）
  const prompts = await loadPrompts();
  const picks = (await llmJSON(pickPrompt(prompts, fresh, LIMIT), '选题')).slice(0, LIMIT);
  console.log(`[pick] 选出 ${picks.length} 个选题：${picks.map((p) => p.topic).join(' / ')}`);
  if (!picks.length) return console.log('[done] 无合适选题');

  // 4. 基础数据（频道/作者/敏感词/标签库）
  const [channels, authors, sensWords, allTags] = await Promise.all([
    fetchAllPages('/channels', '&fields[0]=name&fields[1]=slug'),
    fetchAllPages('/authors', '&fields[0]=name'),
    fetchAllPages('/sensitive-words', '&filters[enabled][$eq]=true&fields[0]=word'),
    fetchAllPages('/tags', '&fields[0]=name&populate[articles][count]=true'),
  ]);
  const channelBySlug = Object.fromEntries(channels.map((c) => [c.slug, c]));
  const words = sensWords.map((w) => w.word).filter(Boolean);
  // 标签治理（防孤岛）：已存在标签集合 + 推荐复用清单（按使用频次降序）注入 prompt，
  // 引导 LLM 优先复用；配合入库时「每篇最多新建 1 个标签」的硬约束（见下方）。
  const existingTagSet = new Set(allTags.map((t) => t.name));
  const tagLib = allTags
    .map((t) => ({ name: t.name, n: t.articles?.count ?? 0 }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 60)
    .map((t) => t.name);

  // 5. 逐选题生成 + 入库
  const results = [];
  for (const sel of picks) {
    const refs = (sel.refs || []).map((i) => fresh[i]).filter(Boolean);
    if (!refs.length) continue;
    try {
      const art = await llmJSON(writePrompt(prompts, sel, refs, tagLib), `成文「${sel.topic}」`);

      // 敏感词过滤 → 命中写入 reviewNote 提示人工重点看
      const hit = words.filter((w) => art.title.includes(w) || art.content.includes(w) || (art.summary || '').includes(w));
      const channel = channelBySlug[sel.channelSlug];
      const author = authors.length ? authors[Math.floor(Math.random() * authors.length)] : null;

      // slug：清洗 + 截短（最多 3 段/30 字符）+ 防撞
      let slug = String(art.slug || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
        .split('-').filter(Boolean).slice(0, 3).join('-').slice(0, 30).replace(/-+$/, '') || `hot-${Date.now()}`;
      const clash = await strapi(`/articles?filters[slug][$eq]=${encodeURIComponent(slug)}&fields[0]=slug`);
      if (clash.data.length) slug = `${slug}-${new Date().toISOString().slice(5, 10).replace('-', '')}`;

      // tags：防孤岛硬约束——已存在的标签优先全部复用；本篇最多只新建 MAX_NEW_TAGS 个新标签，
      // 超出的新标签直接丢弃（宁可标签少也不制造一次性孤岛）。
      const MAX_NEW_TAGS = 1;
      const tagIds = [];
      let newCount = 0;
      const wanted = (art.tags || []).map((t) => t?.name).filter(Boolean).slice(0, 4);
      // 先复用已存在的
      const reuse = wanted.filter((n) => existingTagSet.has(n));
      const brandNew = wanted.filter((n) => !existingTagSet.has(n));
      for (const name of reuse) {
        const found = await strapi(`/tags?filters[name][$eq]=${encodeURIComponent(name)}&fields[0]=name`);
        if (found.data.length) tagIds.push(found.data[0].documentId);
      }
      for (const name of brandNew) {
        if (newCount >= MAX_NEW_TAGS) break; // 超额新标签丢弃，抑制孤岛
        const src = (art.tags || []).find((t) => t?.name === name);
        const created = await strapi('/tags', { method: 'POST', body: JSON.stringify({ data: { name, slug: String(src?.slug || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-') || undefined } }) });
        tagIds.push(created.data.documentId);
        existingTagSet.add(name); // 同轮后续文章即可复用它
        newCount += 1;
      }

      // 封面：从素材条目采集第一张可下载的图（至少一图展示；全失败则无图发布）
      let coverId = null;
      if (!DRY) {
        for (const r of refs) {
          if (!r.cover) continue;
          coverId = await uploadCover(r.cover, slug);
          if (coverId) break;
        }
        if (!coverId) console.warn(`[warn] 「${sel.topic}」素材无可用封面图`);
      }

      // 自动发布仅限「未命中敏感词 + 频道映射成功」的文章；否则留草稿 pending 人工审
      const publish = AUTO_PUBLISH && !hit.length && !!channel;
      const data = {
        title: art.title, slug, summary: (art.summary || '').slice(0, 300), content: art.content,
        cover: coverId ?? undefined,
        channel: channel?.documentId, tags: tagIds,
        authorRef: author?.documentId, author: author?.name,
        source: [...new Set(refs.map((r) => r.source))].join('/'),
        reviewState: publish ? 'approved' : 'pending',
        publishAt: publish ? new Date().toISOString() : undefined,
        reviewNote: hit.length ? `⚠️ 命中敏感词：${hit.join('、')}` : undefined,
        seo: art.seo ? { metaTitle: (art.seo.metaTitle || '').slice(0, 70), metaDescription: (art.seo.metaDescription || '').slice(0, 160), keywords: art.seo.keywords } : undefined,
      };

      if (DRY) {
        console.log(`[dry] ${art.title} → ${sel.channelSlug} tags=${(art.tags || []).map((t) => t.name).join(',')}${hit.length ? ` ⚠️敏感词:${hit.join('、')}` : ''}`);
      } else {
        const created = await strapi(`/articles${publish ? '?status=published' : ''}`, { method: 'POST', body: JSON.stringify({ data }) });
        console.log(`[save] ${publish ? '已发布' : '草稿'} ✓ ${art.title} /${sel.channelSlug}/${slug} (${created.data.documentId})${hit.length ? ` ⚠️敏感词:${hit.join('、')}` : ''}`);
        for (const r of refs) state.done[fingerprint(r.title)] = { t: r.title.slice(0, 30), at: new Date().toISOString(), doc: created.data.documentId };
        writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
      }
      results.push(art.title);
    } catch (e) {
      console.error(`[error] 「${sel.topic}」失败: ${e.message}`);
    }
  }
  console.log(`[done] 生成 ${results.length}/${picks.length} 篇${DRY ? '（dry-run 未入库）' : AUTO_PUBLISH ? '（自动发布开启，敏感词命中者留草稿）' : '，已入草稿箱等待审核（reviewState=pending）'}`);
}

main().catch((e) => { console.error(`[fatal] ${e.message}`); process.exit(1); });
