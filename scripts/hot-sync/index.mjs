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
 * 反雷同：一篇一体裁（WRITE_STYLES 10 种，按频道亲和 + 最近用过的不重复轮换）+ 全局禁令
 *      + 把最近 20 篇的标题/开头作为「已用写法」注入禁令，防止模型长出新套路。
 *
 * 用法：node index.mjs [--limit 5] [--sources weibo,baidu,douyin,toutiao,zhihu] [--dry-run] [--backend claude|minimax]
 *      node index.mjs --upgrade-prompt   # 把后台「热榜二创配置」刷成内置新版 prompt（旧值备份进 note）
 */
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
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
// 把后台「热榜二创配置」的 prompt 强制刷成脚本内置新版（旧值备份进 note 字段）
const UPGRADE_PROMPT = argv.includes('--upgrade-prompt');
// 只跑站内主题盘点补位（跳过热榜）——手动补量或验证补位逻辑时用
const FILL_ONLY = argv.includes('--fill-only');
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

// ---------- 单实例锁 ----------
// state.json 的去重状态只在每篇入库后才落盘，若两个实例并行（如 cron 跑着时手动又跑一次），
// 后启动的那个会读到尚未更新的状态 → 选中同一个话题 → 产出重复文章（2026-07-27 实际踩到）。
// 用排它创建的锁文件把并发挡住；锁超过 STALE_MS 视为上次崩溃遗留，可接管。
const LOCK_FILE = join(DIR, '.run.lock');
const LOCK_STALE_MS = 60 * 60 * 1000;

let lockHeld = false; // 只有真正抢到锁的实例才有资格释放，否则会把别人的锁删掉

function acquireLock() {
  try {
    writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), { flag: 'wx' });
    lockHeld = true;
    return true;
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    let age = Infinity;
    try { age = Date.now() - new Date(JSON.parse(readFileSync(LOCK_FILE, 'utf8')).at).getTime(); } catch { /* 锁文件损坏 → 当作过期 */ }
    if (age < LOCK_STALE_MS) return false;
    console.warn(`[lock] 发现 ${Math.round(age / 60000)} 分钟前的残留锁，接管`);
    writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    lockHeld = true;
    return true;
  }
}

function releaseLock() {
  if (!lockHeld) return; // 没抢到锁的实例不得删锁
  try { if (existsSync(LOCK_FILE)) rmSync(LOCK_FILE); } catch { /* 释放失败不影响主流程，靠 STALE 兜底 */ }
  lockHeld = false;
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
      // 触发订阅限速时不要继续重试——重试只会把剩余配额烧光，直接中止本轮，等下一轮 cron
      if (/rate.?limit|usage limit|too many requests|429|quota/i.test(e.message)) {
        throw new Error(`RATE_LIMIT: ${e.message.slice(0, 120)}（已中止本轮，等下一轮 cron 重试）`);
      }
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
// 上传并返回 { id, url }（url 供正文配图拼 markdown 用）；失败返回 null
async function uploadMedia(url, name) {
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
    const f = json[0];
    return f?.id ? { id: f.id, url: f.url } : null;
  } catch (e) {
    console.warn(`[warn] 图片采集失败(${e.message}): ${String(url).slice(0, 80)}`);
    return null;
  }
}

async function uploadCover(url, name) {
  const m = await uploadMedia(url, name);
  return m?.id ?? null;
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

// ---------- 体裁提示词库（反雷同的主力）----------
// 背景：早期只有一份 write prompt 且写死了结构（钩子→梳理→网友讨论→抛问），
// 导致 67% 的文章以「你怎么看」结尾、48% 出现「据网友讨论」。
// 现改为「一篇一体裁」：每份体裁自带 角色 / 结构 / 标题写法 / 收尾方式 / 专属禁令，
// 按频道亲和 + 最近用过的不重复来轮换（见 pickStyle）。
// channels: '*' 表示通用；否则只在这些频道优先使用。
const WRITE_STYLES = [
  {
    key: 'timeline', name: '时间线扒瓜', channels: '*',
    faq: true,
    role: '你是擅长把一团乱麻的瓜按时间轴捋顺的资讯编辑，读者看你的稿子是为了「一次搞清楚事情怎么走到今天」。',
    structure: [
      '导语 2~3 句：一句话说清「现在到哪一步了」，不铺垫不抒情',
      '用 3~5 个时间点做小标题（如「7月20日 事情起头」「7月26日 当事人发声」），按时间顺序还原，每段 150~250 字',
      '末段「目前进展」：写清最新状态 + 还没有定论的部分',
    ],
    title: '突出「始末 / 来龙去脉 / 时间线 / 几天几变」，让人一眼知道这是一篇捋清楚的稿',
    ending: '以「目前进展 + 还没落定的事」收尾，不许提问、不许喊话读者',
    bans: '时间点必须来自素材；素材没给具体日期的，写「此前」「近日」，禁止编造精确日期',
  },
  {
    key: 'dossier', name: '黑料档案', channels: ['dirt', 'star', 'influencer', 'history'],
    role: '你是负责人物争议档案的资料编辑，写法像在整理一份「档案卡」，冷静、克制、有条理。',
    structure: [
      '开头一句给本次事件定位：这是这个人第几次因为类似问题被讨论',
      '「本次事件」：交代这回发生了什么',
      '「过往记录」：按阶段列 2~4 条以往争议，每条一小段',
      '「争议为什么反复」：从公开信息里找共性',
    ],
    title: '突出人物 +「档案 / 旧账 / 翻车史 / 又一次」，不用感叹号',
    ending: '以「这些争议之间的共同点」收尾',
    bans: '过往争议只能写素材里出现过的；素材没有就直说「公开可查的信息有限」，严禁凭印象补黑历史（法律风险最高的一档，宁可少写）',
  },
  {
    key: 'insider', name: '爆料拆解', channels: ['inside', 'dirt', 'star'],
    faq: true,
    role: '你是专门核实爆料的编辑，读者要的是「这堆料里哪些站得住」。',
    structure: [
      '导语：谁在爆、爆了什么、为什么现在爆',
      '把爆料拆成【爆料一】【爆料二】…每条 100~200 字，每条结尾单起一行标注【可信度：已有公开信息佐证 / 仅网传 / 存疑】',
      '末段「目前能确定的只有」：把确定与未确定分开列清楚',
    ],
    title: '突出「爆料 / 知情人 / 曝出 / 实锤了吗」',
    ending: '以「确定的 vs 还只是网传的」两栏式总结收尾',
    bans: '可信度标注必须诚实，素材里没有佐证的一律标【仅网传】或【存疑】；不得把网传当既成事实转述',
  },
  {
    key: 'debate', name: '两派吵翻实录', channels: ['society', 'campus', 'love', 'sports'],
    role: '你是舆论观察编辑，职责是把两边的道理都讲明白，自己不下场。',
    structure: [
      '一句话说清争议点在哪',
      '「支持的一派怎么说」：列出他们最有力的 2~3 条理由',
      '「反对的一派怎么说」：同样列 2~3 条',
      '「还有第三种声音」：中间派/跑题派的看法',
      '结尾：写清「分歧的根子在哪」',
    ],
    title: '突出对立，如「A 还是 B」「该不该」「两派吵起来了」，但禁止用「吵翻了」三个字',
    ending: '以「分歧的根子」收尾，不许站队、不许下结论',
    bans: '三方观点都必须写得成立，不得把某一派写成明显的稻草人；不得出现编辑本人的立场',
  },
  {
    key: 'qna', name: '几问几答', channels: '*',
    role: '你是面向读者答疑的编辑，把读者点进来最想问的问题一个个答掉。',
    structure: [
      '导语 2 句：这事为什么被问得最多',
      '用 4~5 个问句做小标题（如「XX 到底怎么回事？」「有官方说法吗？」），每问 120~220 字作答',
      '最后一问固定是「哪些还没有答案？」',
    ],
    title: '可用疑问句，但禁止「网友吵翻了」式尾巴',
    ending: '以「还没有答案的部分」收尾',
    bans: '每个问题必须真能从素材里答出来；答不了的直接写「目前没有公开信息」，不许含糊带过',
  },
  {
    key: 'deepdig', name: '深扒起底', channels: ['star', 'influencer', 'inside', 'oversea'],
    faq: true,
    role: '你是擅长把人物关系和来龙去脉扒清楚的编辑，读者要的是背景知识。',
    structure: [
      '从一个具体细节切入（素材里的某句话、某个画面）',
      '「牵涉到的人」：把相关人物和关系交代清楚',
      '「事情怎么走到今天」：背景铺陈',
      '「几个说不通的地方」：列出疑点',
    ],
    title: '突出「起底 / 扒一扒 / 背后 / 关系」',
    ending: '以「最值得继续盯的疑点」收尾',
    bans: '人物关系只能依据素材；不确定的关系写「据网传」并明确未证实，禁止臆测亲属/资金关系',
  },
  {
    key: 'factcheck', name: '求证核查', channels: '*',
    faq: true,
    role: '你是事实核查编辑，专门处理真假难辨、传得很凶的说法。',
    structure: [
      '导语：哪条说法在传、传成了什么样',
      '把传播中的说法逐条列出，每条给出【已被证实 / 已被否认 / 暂无证据】+ 依据来源',
      '末段「还需要谁来回应」',
    ],
    title: '突出「是真的吗 / 求证 / 辟谣 / 有没有实锤」',
    ending: '以「还缺哪一方的回应」收尾',
    bans: '没有依据的一律判【暂无证据】，绝不替当事人下结论；不得用「据悉」掩盖没有来源的判断',
  },
  {
    key: 'scene', name: '现场还原', channels: ['video', 'sports', 'campus', 'society'],
    role: '你是画面感很强的现场描述编辑，先让读者「看见」，再讲为什么火。',
    structure: [
      '开篇把画面写出来：发生了什么、什么样子、多长时间',
      '「为什么这段能传开」：从传播角度分析',
      '「当事人和围观者的反应」',
    ],
    title: '突出画面本身，动词开头，禁止「太魔性」「这一幕」等已用滥的词',
    ending: '以「这段画面之所以传开」收尾',
    bans: '只描述素材里出现过的画面；不得虚构动作、台词、表情和现场对话',
  },
  {
    key: 'roundup', name: '瓜串盘点', channels: '*',
    role: '你是盘点编辑，一次把几件相关的事串起来讲。',
    structure: [
      '导语点题：这几件事有什么共同点',
      '每件事一个小标题 + 100~180 字',
      '结尾一段把它们串起来',
    ],
    title: '突出「盘点 / 一次说清 / 几件事」，标明数量（如「三件事」）',
    ending: '以「串起来看能看出什么」收尾',
    bans: '只盘点素材里真实存在的条目，凑不够数量就少写几条，禁止硬凑',
  },
  {
    key: 'reaction', name: '回应速递', channels: '*',
    faq: true,
    role: '你是跟进当事人回应的编辑，重点是「回应了什么、避开了什么」。',
    structure: [
      '先给回应本身：谁、什么时候、通过什么渠道、说了什么',
      '「回应了哪些、绕开了哪些」：逐条对照此前的质疑',
      '「这份回应能不能服众」：从公开讨论里看接受度',
    ],
    title: '突出「回应 / 发声 / 正面回应了吗」',
    ending: '以「还没被回应的问题」收尾',
    bans: '回应内容必须逐字忠实于素材，不得改写当事人原话的语气和程度',
  },
];

// 全局禁令（a02「禁止清单优于笼统要求」）：把已经写滥的套路点名禁掉
const GLOBAL_BANS = [
  '结尾禁止向读者提问或喊话：「你怎么看」「你觉得呢」「评论区聊聊」「欢迎留言」「一起吃瓜」全部禁用——按本篇体裁指定的方式收尾',
  '「据网友讨论」「网传消息称」两个短语全篇各最多出现 1 次；其余归因请换着说：有网友翻出、评论区里、这两天的讨论集中在、多个平台的说法是、目前公开的信息只到、爆料帖里提到',
  '标题禁用这些已经用滥的词：网友吵翻了、引热议、网友直呼、全网围观、太魔性、炸了、你敢信、这一幕、意想不到',
  '禁止 AI 腔：不仅…而且、值得注意的是、总的来说、综上所述、在这个…的时代、让我们、首先/其次/最后 的三段式、无实义的排比句',
  '禁止自称：本文、笔者、小编、我们编辑部',
  '句子要短，多用口语的短句；不要每段都用「其实」「说白了」「不得不说」开头',
  '正文里不要出现「梳理一下」「先来看看」这类流程性套话，直接进入内容',
].map((s, i) => `${i + 1}. ${s}`).join('\n');

// 默认 prompt（单一事实来源在此；后台「热榜二创配置」字段为空时首跑会自动填入，之后以后台为准）
const DEFAULT_PICK_PROMPT = `你是吃瓜资讯站「今日吃瓜」的选题编辑。以下是当前各平台热榜（编号. [来源] 标题 | 热度 | 补充说明）：

{{topics}}

从中选出最多 {{limit}} 个适合本站的选题。硬性规则：
- 只选「吃瓜向」：明星/网红/影视综艺/社会趣闻/体育人物/海外热点/情感话题等大众娱乐谈资
- 必须排除：时政、政府政策、领导人、军事外交、民族宗教、重大灾难伤亡、疫情防控等严肃或敏感议题
- 同一事件在多个榜单出现的，合并为一个选题（refs 列出所有相关编号）
- 每个选题从以下频道中选最贴切的一个：
{{channels}}
- angle（切入角度）本批之间必须各不相同：不要所有选题都写成「争议/网友吵翻」一个路子。可用的角度类型举例：还原过程、核实真假、扒背景关系、对比同类事件、当事人回应、围观者反应、行业视角、旧事重提。同一批里同一种角度类型最多用 2 次

只输出 JSON 数组，不要任何其他文字：
[{"topic":"选题概括(一句话)","angle":"吃瓜切入角度(一句话)","channelSlug":"频道slug","refs":[相关条目编号]}]`;

const DEFAULT_WRITE_PROMPT = `【角色】
{{styleRole}}
你在为吃瓜资讯站「今日吃瓜」供稿，读者是刷手机看热闹的普通网友。

【任务】
用下面的素材写一篇原创短资讯，体裁为「{{styleName}}」，正文 900~1500 字。

选题：{{topic}}
切入角度：{{angle}}

【素材】（唯一事实依据，素材之外的一切细节都不许写）
{{refs}}

【结构】本篇必须按「{{styleName}}」的骨架写，不要套用其他体裁：
{{styleStructure}}
- 标题写法：{{styleTitle}}
- 收尾方式：{{styleEnding}}

【约束】
- 事实纪律（最重要）：只依据上面素材成文；素材没有的具体人名/数字/时间/引语一律不得编造；未证实信息必须写明未证实；不诽谤、不定罪、不替当事人下结论，争议事件中立转述
- 本体裁专属禁令：{{styleBans}}
- 全局禁令（违反任意一条都算不合格）：
{{bans}}
- 最近已经发过的写法如下，本篇的标题句式和开头必须与它们明显不同：
{{recent}}
- 语气像朋友聊天，但不低俗、不油腻；移动端短段落，每段不超过 4 行
- 正文必须用「## 小标题」分段，至少 2 个；outline 里列的小标题要真的写进正文，不能只列不写
- 正文中必须自然嵌入 2~3 条站内链接，markdown 格式：[锚文本](/频道/slug)
  · 路径**只能**从下面「可链接文章」里原样复制，一个字符都不能改，严禁自己编造路径
  · 锚文本要是句子里的自然短语（如「此前那起校园争议」），禁止「点击这里」「查看详情」这类空锚文本
  · 链接放在正文语义相关处，不要堆在结尾
  可链接文章（路径必须原样复制）：
{{links}}
{{faqBlock}}
- summary ≤120 字，不要复读标题
- slug：英文小写连字符，2~3 个词，尽量短（SEO 用）
- tags：3~5 个，name 中文、slug 英文小写连字符。**必须优先从下面「可复用标签库」里选**，尽量全部命中；标签要用「可跨事件复用的话题词/品类词」(如 明星、恋情、塌房、综艺、体育)，**不要用一次性的具体人名或单一事件词做标签**(如 某某某、某活动名)——那会产生只有一篇的孤岛标签页。最多只允许出现 1 个库里没有的新标签，且该新标签也必须是能被后续文章复用的通用词。
  可复用标签库(优先复用)：{{taglib}}
- seo.metaTitle ≤60 字符
- seo.metaDescription **120~160 字符**（少于 120 字视为不合格——这是搜索结果里的摘要位，要写满，自然融入关键词）
- seo.keywords 逗号分隔 3~5 个中文词
- 标题 ≤40 字，吸引点击但不夸张失实

【格式】
先在 outline 字段里按上面的结构列出本篇的小标题草案（3~5 条），再照着它写 content——先列后写，不要边想边写。
首段必须自然出现 seo.keywords 的第一个关键词，但不要为塞词而生硬。

只输出 JSON，不要任何其他文字。注意：content 里的换行必须转义为 \\n；标题和正文中一律使用中文引号「」或书名号《》，禁止出现英文双引号字符，确保整体是合法 JSON：
{"outline":["小标题1","小标题2"],"title":"...","slug":"...","summary":"...","content":"markdown正文","tags":[{"name":"...","slug":"..."}],"seo":{"metaTitle":"...","metaDescription":"...","keywords":"..."}}`;

function render(tpl, vars) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');
}

// ---------- 套话自检（prompt 约束不够硬，出稿后再机器校一遍）----------
const BODY_BANS = [
  { re: /(你怎么看|你觉得呢|你怎么想|评论区(聊聊|见|等你|说说)|欢迎留言|一起吃瓜)/, msg: '向读者提问/喊话' },
  { re: /(不仅.{0,12}而且|值得注意的是|总的来说|综上所述|在这个.{0,10}时代|让我们一起)/, msg: 'AI 腔套话' },
  { re: /(本文|笔者|小编)/, msg: '禁止自称' },
  { re: /(梳理一下|先来梳理|先来看看|让我们来看)/, msg: '流程性套话' },
];
const TITLE_BANS = /(网友吵翻|引热议|网友直呼|全网围观|太魔性|炸了吗?|你敢信|这一幕|意想不到)/;
const HEDGE_LIMIT = { 据网友讨论: 1, 网传消息称: 1 };

// 标点归一化：模型偶尔在中文句子里混用半角标点（现存文章里 59 篇有此问题）。
// 只在「前后都是中日韩汉字」时替换，避免误伤英文、代码、URL、数字。
function normalizePunct(s) {
  return String(s || '')
    .replace(/([一-龥])\s*,\s*([一-龥])/g, '$1，$2')
    .replace(/([一-龥])\s*;\s*([一-龥])/g, '$1；$2')
    .replace(/([一-龥])\s*:\s*([一-龥])/g, '$1：$2')
    .replace(/([一-龥])\s*!\s*/g, '$1！')
    .replace(/([一-龥])\s*\?\s*/g, '$1？');
}

// ---------- 近重复守卫 ----------
// 热榜同一事件换个说法会二次上榜，指纹去重（按标题原文）挡不住；
// 2026-07-27 实际出现过「痞幼…能自证吗」与「痞幼…经得起求证吗」两篇几乎同题。
// 这里用字符二元组 Jaccard 相似度，跟近期已发标题比一遍。
function bigrams(s) {
  const t = String(s || '').replace(/[\s\p{P}\p{S}]/gu, '');
  const out = new Set();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}
function similarity(a, b) {
  const A = bigrams(a); const B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  return inter / (A.size + B.size - inter);
}
// 阈值 0.30：用全量 262 条历史标题跑过分布——≥0.30 的 9 对全部是同一事件被写了两遍
// （昆明吃菌子 0.76、詹姆斯签约 0.32/0.31、正颌手术 0.31、土耳其捅 6 刀 0.30…），
// 0.30 以下没有真重复，误杀风险低。
const DUP_THRESHOLD = 0.30;

async function findNearDuplicate(title, n = 120) {
  try {
    const res = await strapi(`/articles?sort=createdAt:desc&pagination[pageSize]=${n}&fields[0]=title&fields[1]=slug`);
    let best = null;
    for (const a of res.data || []) {
      const score = similarity(title, a.title);
      if (score >= DUP_THRESHOLD && (!best || score > best.score)) best = { title: a.title, slug: a.slug, score };
    }
    return best;
  } catch (e) {
    console.warn(`[warn] 近重复检查失败（跳过）: ${e.message.slice(0, 60)}`);
    return null;
  }
}

// SEO 结构自检（对齐 p045 发布后检查清单 + p108 修复后检查标准 + p111 FAQ）
function lintSeo(art, style) {
  const v = [];
  const c = String(art.content || '');
  const heads = (c.match(/^##+ /gm) || []).length;
  if (heads < 2) v.push(`小标题不足（${heads} 个，需 ≥2）`);
  const links = [...c.matchAll(/\]\((\/[^)]+)\)/g)].length;
  if (links < 2) v.push(`站内链接不足（${links} 条，需 2~3）`);
  const d = String(art.seo?.metaDescription || '');
  if (d.length < 120) v.push(`metaDescription 过短（${d.length} 字，需 120~160）`);
  const kw = String(art.seo?.keywords || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean).length;
  if (kw < 3 || kw > 5) v.push(`keywords 数量 ${kw}（需 3~5）`);
  // FAQ 按「结构」检测而不是按标题措辞——提示词特意要求换着叫（「读者最关心的几件事」等），
  // 若在这里只认含「问/答/FAQ」的标题，就会把合规稿判成不合规。
  if (style?.faq) {
    const lastSection = c.split(/\n##+ /).pop() || '';
    const qs = lastSection.split('\n').filter((l) => /[？?]\s*\**\s*$/.test(l.trim())).length;
    if (qs < 3) v.push(`FAQ 问答不足（末节 ${qs} 问，需 ≥3）`);
  }
  return v;
}

// 内链白名单校验：把不在候选集内的链接降级为纯文本（宁可没有内链，也不要 404 内链）
function sanitizeLinks(content, candidates) {
  const allowed = new Set(candidates.map((c) => c.path));
  let forged = 0;
  const out = String(content || '').replace(/\[([^\]\n]+)\]\((\/[^)\s]+)\)/g, (m, txt, path) => {
    if (allowed.has(path)) return m;
    forged += 1;
    return txt;
  });
  return { content: out, forged };
}

function lintStyle(art) {
  const v = [];
  const c = String(art.content || '');
  const t = String(art.title || '');
  for (const b of BODY_BANS) {
    const m = c.match(b.re);
    if (m) v.push(`${b.msg}（「${m[0]}」）`);
  }
  const tm = t.match(TITLE_BANS);
  if (tm) v.push(`标题用了已写滥的词（「${tm[0]}」）`);
  for (const [phrase, limit] of Object.entries(HEDGE_LIMIT)) {
    const n = (c.match(new RegExp(phrase, 'g')) || []).length;
    if (n > limit) v.push(`「${phrase}」出现 ${n} 次（上限 ${limit}）`);
  }
  return v;
}

// 体裁轮换：优先本频道适配的体裁，且避开最近 RECENT_STYLE_WINDOW 篇用过的；
// 都用过了就退回全池随机，保证一定能选出一个。
const RECENT_STYLE_WINDOW = 6;
function pickStyle(sel, state, usedThisRun) {
  const recent = (state.styles || []).slice(-RECENT_STYLE_WINDOW).map((s) => s.k);
  const fit = WRITE_STYLES.filter((s) => s.channels === '*' || s.channels.includes(sel.channelSlug));
  const pool = fit.length ? fit : WRITE_STYLES;
  const fresh = pool.filter((s) => !recent.includes(s.key) && !usedThisRun.has(s.key));
  const cand = fresh.length ? fresh : pool.filter((s) => !usedThisRun.has(s.key));
  const list = cand.length ? cand : pool;
  return list[Math.floor(Math.random() * list.length)];
}

// ---------- 站内主题补位选题 ----------
// 热榜去重后新话题不够时的兜底：把站内同标签的多篇已发文章聚合成一篇盘点。
// 刻意不做「换壳重写」（p112 的做法，已判定不采纳——那是站内重复内容）；
// 盘点是真正的新内容：新的聚合视角 + 天然带一批指向成员文章的内链。
const FILL_MIN_GROUP = 3;      // 同一标签+同一频道下至少几篇才够盘
const FILL_COOLDOWN_DAYS = 7;  // 同一标签多少天内不重复盘
const FILL_MAX_CHANNELS = 5;   // 标签跨频道数超过它 → 判为泛标签，盘出来会是大杂烩
// 兜底黑名单（跨频道判据之外的显式排除；这几个是站内最典型的万金油标签）
const FILL_TAG_STOPLIST = new Set(['网络热议', '热搜', '吃瓜', '围观', '微博热搜', '大瓜', '出圈', '热榜']);

async function buildFillPicks(need, state) {
  if (need <= 0) return [];
  try {
    const res = await strapi('/articles?sort=publishAt:desc&pagination[pageSize]=100'
      + '&fields[0]=title&fields[1]=slug&fields[2]=summary'
      + '&populate[tags][fields][0]=name&populate[channel][fields][0]=slug&populate[cover][fields][0]=id');
    const arts = (res.data || []).filter((a) => a.slug && a.channel?.slug);

    // 按标签分组
    const byTag = new Map();
    for (const a of arts) {
      for (const t of a.tags || []) {
        if (!t?.name) continue;
        if (!byTag.has(t.name)) byTag.set(t.name, []);
        byTag.get(t.name).push(a);
      }
    }

    const cooling = new Set(
      (state.fills || [])
        .filter((f) => Date.now() - new Date(f.at).getTime() < FILL_COOLDOWN_DAYS * 86400000)
        .map((f) => f.tag),
    );

    // 主题连贯性过滤：泛标签（如「网络热议」铺满 11 个频道）盘出来是大杂烩，
    // 只保留「跨频道少」的主题标签，且成员必须落在同一个频道内。
    const groups = [];
    for (const [tag, list] of byTag) {
      if (cooling.has(tag) || FILL_TAG_STOPLIST.has(tag)) continue;
      const channels = new Set(list.map((a) => a.channel.slug));
      if (channels.size > FILL_MAX_CHANNELS) continue;
      // 取该标签下成员最多的频道，只用这个频道的文章
      const byCh = new Map();
      for (const a of list) byCh.set(a.channel.slug, [...(byCh.get(a.channel.slug) || []), a]);
      const [channelSlug, sameCh] = [...byCh.entries()].sort((a, b) => b[1].length - a[1].length)[0];
      if (sameCh.length < FILL_MIN_GROUP) continue;
      groups.push({ tag, channelSlug, list: sameCh });
    }

    return groups
      .sort((a, b) => b.list.length - a.list.length)
      .slice(0, need)
      .map(({ tag, channelSlug, list }) => {
        const members = list.slice(0, 5);
        return {
          kind: 'fill',
          tag,
          topic: `「${tag}」最近的这几件事`,
          angle: '把站内近期同类事件串成一篇盘点，交代每件事的要点与共同点',
          channelSlug,
          coverId: members.find((m) => m.cover?.id)?.cover?.id ?? null,
          materials: members.map((m) => ({
            source: '本站',
            title: m.title,
            desc: m.summary || '',
            path: `/${m.channel.slug}/${m.slug}`,
          })),
        };
      });
  } catch (e) {
    console.warn(`[warn] 站内补位选题构建失败: ${e.message.slice(0, 100)}`);
    return [];
  }
}

// ---------- 内链候选集 ----------
// 模型不知道站内有什么文章，直接要求加内链必然编造 URL，而 404 内链比没有内链更伤。
// 因此：把候选清单喂给它 → 生成后校验链接必须落在候选集内 → 不足则兜底追加。
async function fetchLinkCandidates(channelSlug, n = 20) {
  const q = (filter) => `/articles?sort=publishAt:desc&pagination[pageSize]=${n}`
    + `&fields[0]=title&fields[1]=slug&populate[channel][fields][0]=slug${filter}`;
  const pick = (res) => (res.data || [])
    .filter((a) => a.slug && a.channel?.slug)
    .map((a) => ({ title: a.title, path: `/${a.channel.slug}/${a.slug}` }));
  try {
    // 优先同频道（相关性最高），不足再用全站最新补齐
    let list = channelSlug
      ? pick(await strapi(q(`&filters[channel][slug][$eq]=${encodeURIComponent(channelSlug)}`)))
      : [];
    if (list.length < 6) {
      const more = pick(await strapi(q('')));
      const seen = new Set(list.map((x) => x.path));
      list = [...list, ...more.filter((x) => !seen.has(x.path))];
    }
    return list.slice(0, n);
  } catch (e) {
    console.warn(`[warn] 内链候选拉取失败: ${e.message.slice(0, 80)}`);
    return [];
  }
}

function renderLinks(cands) {
  if (!cands.length) return '  （暂无可链接文章，本篇可不加站内链接）';
  return cands.map((c) => `  - ${c.path} ｜ ${c.title}`).join('\n');
}

// FAQ 注入块（改造项 4-A：只对 5 个「事件解析类」体裁开启，避免所有文章长同一个尾巴）
function renderFaqBlock(style) {
  if (!style.faq) return '';
  return `- 正文末尾加一个 FAQ 小节（3~5 问）：问题必须是读者真会去搜的具体问题；只写素材里答得出的，答不了的直接写「目前没有公开信息」；每问 2~3 行
  · 小节标题不要每篇都叫「FAQ」，按本篇体裁换个说法（如「几个还在被追问的问题」「读者最关心的几件事」）`;
}

// 最近已发文章的「标题 + 开头首句」采样，作为动态禁令注入——
// 静态禁令只能挡住已知套路，这个能挡住模型新长出来的套路。
async function fetchRecentSignals(n = 20) {
  try {
    const res = await strapi(`/articles?sort=createdAt:desc&pagination[pageSize]=${n}&fields[0]=title&fields[1]=content`);
    return (res.data || []).map((a) => {
      const first = String(a.content || '')
        .split('\n').map((s) => s.trim())
        .find((s) => s && !s.startsWith('#') && !s.startsWith('!')) || '';
      return { title: a.title || '', open: first.slice(0, 28) };
    }).filter((x) => x.title);
  } catch (e) {
    console.warn(`[warn] 最近文章采样失败（跳过动态禁令）: ${e.message.slice(0, 80)}`);
    return [];
  }
}

function renderRecent(signals) {
  if (!signals.length) return '（暂无历史稿件，按上面的体裁自由发挥即可）';
  return signals.map((s) => `- 标题「${s.title}」｜开头「${s.open}…」`).join('\n');
}

// 后台旧模板（无 {{style}} 占位符）的兼容注入：运行时追加到 prompt 末尾，
// 保证体裁轮换对老配置也生效；想彻底换新模板用 --upgrade-prompt。
const STYLE_APPENDIX = `

──── 以下为本次生成的体裁与反套路要求（脚本自动追加，优先级高于上文）────
【本篇体裁】{{styleName}}
{{styleRole}}
结构：
{{styleStructure}}
标题写法：{{styleTitle}}
收尾方式：{{styleEnding}}
体裁专属禁令：{{styleBans}}

【全局禁令】
{{bans}}

【最近已用过的写法，本篇必须明显不同】
{{recent}}`;

// SEO 结构要求（后台旧模板缺 {{links}} 占位符时运行时追加）
const SEO_APPENDIX = `

──── SEO 结构要求（脚本自动追加）────
- 正文必须用 \`## 小标题\` 分段，至少 2 个
- 正文中必须自然嵌入 2~3 条站内链接，格式 \`[锚文本](路径)\`；路径只能从下面清单原样复制，严禁编造；锚文本要是自然短语，禁止「点击这里」
  可链接文章：
{{links}}
{{faqBlock}}
- seo.metaDescription 120~160 字符（少于 120 视为不合格）；seo.keywords 3~5 个`;

// 从后台「热榜二创配置」拉 prompt；字段为空则回填默认值（仅填空缺，不覆盖后台手改），读取失败回退内置
async function loadPrompts() {
  try {
    const res = await fetch(`${CFG.strapiUrl}/api/hot-sync-config`, {
      headers: { Authorization: `Bearer ${CFG.strapiToken}` },
    });
    const cfg = res.ok ? (await res.json()).data || {} : {};
    if (!res.ok && res.status !== 404) console.warn(`[warn] 后台 prompt 配置读取 ${res.status}（token 需勾选 hot-sync-config 的 find/update 权限），用内置默认`);
    const fill = {};
    // --upgrade-prompt：把后台模板强制刷成脚本内置的新版（旧值备份进 note，可回退）
    if (UPGRADE_PROMPT) {
      fill.pickPrompt = DEFAULT_PICK_PROMPT;
      fill.writePrompt = DEFAULT_WRITE_PROMPT;
      fill.note = `${new Date().toISOString().slice(0, 16)} 升级为体裁轮换版 prompt。上一版 writePrompt 备份：\n${(cfg.writePrompt || '(空)').slice(0, 2000)}`;
    }
    if (!cfg.pickPrompt?.trim()) fill.pickPrompt = DEFAULT_PICK_PROMPT;
    if (!cfg.writePrompt?.trim()) fill.writePrompt = DEFAULT_WRITE_PROMPT;
    if (Object.keys(fill).length && res.status !== 403) {
      await strapi('/hot-sync-config', { method: 'PUT', body: JSON.stringify({ data: fill }) })
        .then(() => console.log(`[cfg] 默认 prompt 已回填后台（${Object.keys(fill).join('/')}）`))
        .catch((e) => console.warn(`[warn] 回填后台 prompt 失败: ${e.message.slice(0, 120)}`));
    }
    return {
      pick: (UPGRADE_PROMPT ? '' : cfg.pickPrompt?.trim()) || DEFAULT_PICK_PROMPT,
      write: (UPGRADE_PROMPT ? '' : cfg.writePrompt?.trim()) || DEFAULT_WRITE_PROMPT,
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

function writePrompt(prompts, sel, refs, tagLib = [], style, recent = [], links = []) {
  let tpl = prompts.write.includes('{{style') ? prompts.write : prompts.write + STYLE_APPENDIX;
  // 后台模板若是旧版（没有内链/FAQ 占位符），运行时补挂，保证改造对老配置也生效
  if (!tpl.includes('{{links}}')) tpl += SEO_APPENDIX;
  return render(tpl, {
    links: renderLinks(links),
    faqBlock: renderFaqBlock(style),
    topic: sel.topic,
    angle: sel.angle,
    refs: refs.map((r) => `- [${r.source}] ${r.title}${r.desc ? `：${r.desc}` : ''}`).join('\n'),
    taglib: tagLib.join('、'),
    styleName: style.name,
    styleRole: style.role,
    styleStructure: style.structure.map((s) => `- ${s}`).join('\n'),
    styleTitle: style.title,
    styleEnding: style.ending,
    styleBans: style.bans,
    bans: GLOBAL_BANS,
    recent: renderRecent(recent),
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

  // 并发保护：dry-run 不写状态，不必占锁
  if (!DRY && !acquireLock()) {
    return console.log('[skip] 已有一个实例在跑（.run.lock 存在），本次退出——避免选到同一话题产出重复文章');
  }

  // 1. 同步热榜（--fill-only 时跳过，直接走站内补位）
  const topics = FILL_ONLY ? [] : await fetchHotLists();
  if (!FILL_ONLY && !topics.length) throw new Error('所有热榜源都拉取失败');

  // 2. 去重（跑过的话题不再生成）
  const state = loadState();
  const fresh = topics.filter((t) => !state.done[fingerprint(t.title)]);
  console.log(`[dedup] ${topics.length} 条热榜 → ${fresh.length} 条新话题`);

  // 3. LLM 选题（prompt 优先取后台「热榜二创配置」）
  const prompts = await loadPrompts();
  let picks = [];
  if (FILL_ONLY) {
    console.log('[fill-only] 跳过热榜选题，只跑站内主题盘点');
  } else if (fresh.length) {
    picks = (await llmJSON(pickPrompt(prompts, fresh, LIMIT), '选题')).slice(0, LIMIT);
    console.log(`[pick] 选出 ${picks.length} 个选题：${picks.map((p) => p.topic).join(' / ')}`);
  } else {
    console.log('[dedup] 热榜无新话题');
  }

  // 3b. 热榜不够 → 用站内同主题文章聚合成盘点补位
  const fills = await buildFillPicks(LIMIT - picks.length, state);
  if (fills.length) {
    console.log(`[fill] 热榜缺 ${LIMIT - picks.length} 篇，补位站内主题盘点：${fills.map((f) => f.tag).join(' / ')}`);
    picks = picks.concat(fills);
  }
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

  // 5. 逐选题生成 + 入库（一篇一体裁，轮换 + 最近写法作为动态禁令）
  const recentSignals = await fetchRecentSignals(20);
  const usedStyles = new Set();
  const results = [];
  for (const sel of picks) {
    // 补位选题的素材是站内文章本身；热榜选题的素材是榜单条目
    const refs = sel.kind === 'fill' ? sel.materials : (sel.refs || []).map((i) => fresh[i]).filter(Boolean);
    if (!refs.length) continue;
    try {
      // 补位选题固定用「瓜串盘点」体裁——它就是为聚合多条内容设计的
      const style = sel.kind === 'fill'
        ? WRITE_STYLES.find((s) => s.key === 'roundup')
        : pickStyle(sel, state, usedStyles);
      usedStyles.add(style.key);
      console.log(`[style] 「${sel.topic}」→ ${style.name}(${style.key})${sel.kind === 'fill' ? ' [站内补位]' : ''}`);
      // 补位篇：成员文章优先进内链候选，保证盘点能链回被盘的每一篇
      const linkCands = sel.kind === 'fill'
        ? [...sel.materials.map((m) => ({ title: m.title, path: m.path })),
           ...(await fetchLinkCandidates(sel.channelSlug))]
        : await fetchLinkCandidates(sel.channelSlug);
      const basePrompt = writePrompt(prompts, sel, refs, tagLib, style, recentSignals, linkCands);
      let art = await llmJSON(basePrompt, `成文「${sel.topic}」`);

      // 套话自检 + SEO 结构自检：违规就带着违规清单重写一次
      let violations = [...lintStyle(art), ...lintSeo(art, style)];
      if (violations.length) {
        console.warn(`[lint] 「${sel.topic}」命中 ${violations.length} 条套话，重写一次：${violations.join('；')}`);
        try {
          const retry = await llmJSON(
            `${basePrompt}\n\n【重写要求】你上一版违反了以下禁令，必须逐条改掉，其余内容和结构保持不变：\n- ${violations.join('\n- ')}`,
            `重写「${sel.topic}」`,
          );
          const v2 = [...lintStyle(retry), ...lintSeo(retry, style)];
          if (v2.length < violations.length) { art = retry; violations = v2; }
        } catch (e) {
          console.warn(`[lint] 重写失败，沿用初稿: ${e.message.slice(0, 80)}`);
        }
      }

      // 标点归一化（中文句内的半角标点）
      art.title = normalizePunct(art.title);
      art.summary = normalizePunct(art.summary);
      art.content = normalizePunct(art.content);

      // 近重复守卫：与近期已发文章高度同题的直接丢弃，不入库（站内重复内容对 SEO 是负分）
      const dup = await findNearDuplicate(art.title);
      if (dup) {
        console.warn(`[dup] 「${art.title}」与已发《${dup.title}》相似度 ${dup.score.toFixed(2)}，丢弃不入库`);
        for (const r of refs) if (r.title) state.done[fingerprint(r.title)] = { t: r.title.slice(0, 30), at: new Date().toISOString(), doc: 'dup-skip' };
        writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
        continue;
      }

      // 内链净化：剔除编造路径；不足 2 条时用「相关阅读」兜底（p045：每篇 2~3 条内链）
      const cleaned = sanitizeLinks(art.content, linkCands);
      art.content = cleaned.content;
      if (cleaned.forged) console.warn(`[link] 「${sel.topic}」剔除 ${cleaned.forged} 条编造链接`);
      const linkNow = [...art.content.matchAll(/\]\((\/[^)\s]+)\)/g)].map((m) => m[1]);
      if (linkNow.length < 2 && linkCands.length >= 2) {
        const picks = linkCands.filter((c) => !linkNow.includes(c.path)).slice(0, 2 - linkNow.length + 1);
        if (picks.length) {
          art.content += `\n\n## 相关阅读\n\n${picks.map((p) => `- [${p.title}](${p.path})`).join('\n')}`;
          console.log(`[link] 「${sel.topic}」内链${linkNow.length}条，兜底追加 ${picks.length} 条`);
        }
      }

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
      let coverSrc = '';
      if (!DRY && sel.kind === 'fill') {
        coverId = sel.coverId; // 补位篇复用成员文章的封面，不重复采集
      } else if (!DRY) {
        for (const r of refs) {
          if (!r.cover) continue;
          coverId = await uploadCover(r.cover, slug);
          if (coverId) { coverSrc = r.cover; break; }
        }
        if (!coverId) console.warn(`[warn] 「${sel.topic}」素材无可用封面图`);

        // 正文配图（p045：每 500~800 字一张）：把没用作封面的素材图插到正文中部。
        // 素材没有多余图片就跳过——不硬凑，宁可少一张也不放无关图。
        const spare = refs.map((r) => r.cover).filter((u) => u && u !== coverSrc);
        if (spare.length) {
          const media = await uploadMedia(spare[0], `${slug}-inline`);
          if (media?.url) {
            const blocks = art.content.split('\n').filter((l) => l.trim());
            const at = Math.max(2, Math.floor(blocks.length / 2));
            blocks.splice(at, 0, `![${art.title}](${media.url})`);
            art.content = blocks.join('\n\n');
            console.log(`[img] 「${sel.topic}」正文插图 1 张`);
          }
        }
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
        reviewNote: [
          hit.length ? `⚠️ 命中敏感词：${hit.join('、')}` : '',
          violations.length ? `📝 套话自检未通过（已重写仍残留）：${violations.join('；')}` : '',
        ].filter(Boolean).join('\n') || undefined,
        seo: art.seo ? { metaTitle: (art.seo.metaTitle || '').slice(0, 70), metaDescription: (art.seo.metaDescription || '').slice(0, 160), keywords: art.seo.keywords } : undefined,
      };

      if (DRY) {
        const body = String(art.content || '').split('\n').map((s) => s.trim()).filter(Boolean);
        console.log(`[dry] ${art.title} → ${sel.channelSlug} 体裁=${style.name} 字数=${String(art.content || '').length} tags=${(art.tags || []).map((t) => t.name).join(',')}${hit.length ? ` ⚠️敏感词:${hit.join('、')}` : ''}${violations.length ? ` ⚠️套话:${violations.join('、')}` : ' ✓套话自检通过'}`);
        console.log(`      小标题：${(art.outline || []).join(' / ') || '(未输出 outline)'}`);
        console.log(`      开头：${(body.find((s) => !s.startsWith('#')) || '').slice(0, 50)}…`);
        console.log(`      结尾：…${(body[body.length - 1] || '').slice(-50)}`);
      } else {
        const created = await strapi(`/articles${publish ? '?status=published' : ''}`, { method: 'POST', body: JSON.stringify({ data }) });
        console.log(`[save] ${publish ? '已发布' : '草稿'} ✓ ${art.title} /${sel.channelSlug}/${slug} (${created.data.documentId})${hit.length ? ` ⚠️敏感词:${hit.join('、')}` : ''}`);
        if (sel.kind === 'fill') {
          // 同一标签 FILL_COOLDOWN_DAYS 天内不再盘第二次
          state.fills = [...(state.fills || []), { tag: sel.tag, at: new Date().toISOString() }].slice(-60);
        } else {
          for (const r of refs) state.done[fingerprint(r.title)] = { t: r.title.slice(0, 30), at: new Date().toISOString(), doc: created.data.documentId };
        }
        // 体裁使用记录（只留最近 40 条，供下一轮避重）
        state.styles = [...(state.styles || []), { k: style.key, at: new Date().toISOString() }].slice(-40);
        writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
      }
      results.push(art.title);
    } catch (e) {
      // 限速要整轮中止，不能继续往下跑——否则剩余选题会挨个再撞一次限速
      if (e.message.startsWith('RATE_LIMIT')) {
        console.error(`[abort] ${e.message}`);
        break;
      }
      console.error(`[error] 「${sel.topic}」失败: ${e.message}`);
    }
  }
  console.log(`[done] 生成 ${results.length}/${picks.length} 篇${DRY ? '（dry-run 未入库）' : AUTO_PUBLISH ? '（自动发布开启，敏感词命中者留草稿）' : '，已入草稿箱等待审核（reviewState=pending）'}`);
}

// 用 exitCode 而不是 process.exit()，保证 finally 里的解锁一定执行
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { releaseLock(); process.exit(130); });

main()
  .catch((e) => { console.error(`[fatal] ${e.message}`); process.exitCode = 1; })
  .finally(releaseLock);
