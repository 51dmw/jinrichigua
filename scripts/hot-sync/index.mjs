#!/usr/bin/env node
/**
 * 热榜同步二创脚本（scripts/hot-sync）
 *
 * 管线：热榜/新闻流同步 → LLM 选题(过滤时政敏感/合并跨源同事件) → LLM 二创成文
 *      → 敏感词过滤 → Strapi REST 写入草稿(reviewState=pending) → 后台人工审核发布。
 *
 * 采集源：五个热榜（weibo/baidu/douyin/toutiao/zhihu）——百度/头条/抖音/知乎先直连官方接口，
 *      失败或微博则走 60s API（HOT_API_BASE 多实例按序回退）；腾讯新闻热点榜 qqnews 只直连；
 *      凤凰网自带取数（明星 ifengent / 影视 ifengmov）——只取标题作选题线索，不抓正文。
 *
 * 写入只经 Strapi REST API（符合 DEVELOPMENT_CONSTRAINTS §数据流约束），不直连数据库。
 * 生成后端可插拔：claude（默认，走本机 Claude Code Max 订阅）/ minimax（OpenAI 兼容，需余额）。
 *
 * 反雷同：一篇一体裁（WRITE_STYLES 13 种，按频道亲和 + 最近用过的不重复轮换）+ 全局禁令
 *      + 把最近 20 篇的标题/开头作为「已用写法」注入禁令，防止模型长出新套路。
 *
 * 用法：node index.mjs [--limit 5] [--sources weibo,baidu,douyin,toutiao,zhihu,qqnews,ifengent,ifengmov] [--dry-run] [--backend claude|minimax]
 *      node index.mjs --upgrade-prompt   # 把后台「热榜二创配置」刷成内置新版 prompt（旧值备份进 note）
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from '../lib/env.mjs';
import { createLock } from '../lib/lock.mjs';
import { createStrapi } from '../lib/strapi.mjs';
import { callClaude as callClaudeLib, callOpenAICompat, llmJSON as llmJSONLib } from '../lib/llm.mjs';
import { render, normalizePunct, bigramJaccard, stripUnsupportedMarkup, TABLE_RE, SENSITIVE_BUILTIN, scanSensitive } from '../lib/text.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(DIR, 'state.json');

// ---------- env ----------
loadEnvFile(join(DIR, '.env'), { missingMessage: '缺少 scripts/hot-sync/.env（参照 .env.example）' });

const CFG = {
  strapiUrl: process.env.STRAPI_API_URL || 'http://127.0.0.1:1337',
  strapiToken: process.env.STRAPI_API_TOKEN,
  // Comma-separated, tried in order. The official instance (60s-api.viki.moe) has 403'd this
  // VPS's IP since 2026-08-21 (CF WAF blacklist), so a public mirror goes first.
  // Instance list: https://docs.60s-api.viki.moe/7306811m0
  hotApiBases: (process.env.HOT_API_BASE || 'https://60s.okbaike.com/v2,https://60s-api.viki.moe/v2')
    .split(',').map((s) => s.trim()).filter(Boolean),
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
// 本轮直接用脚本内置 prompt，不读也不写后台——改完默认 prompt 后配合 --dry-run 试跑用
const LOCAL_PROMPT = argv.includes('--local-prompt');
// 只跑站内主题盘点补位（跳过热榜）——手动验证补位逻辑时用。
// 补位盘点默认不再自动触发（见 3b），这是唯一能让它跑起来的入口。
const FILL_ONLY = argv.includes('--fill-only');
// 自动发布：默认开（.env AUTO_PUBLISH=0 或 --draft 关闭）；正文含表格的留草稿人工审核；命中敏感词的改写一次，仍命中则放弃
const AUTO_PUBLISH = !argv.includes('--draft') && (process.env.AUTO_PUBLISH ?? '1') !== '0';
const BACKEND = arg('backend', CFG.backend);
const SOURCE_KEYS = arg('sources', 'weibo,baidu,douyin,toutiao,zhihu,qqnews,ifengent,ifengmov').split(',').map((s) => s.trim());

// ---------- 热榜源适配 ----------
// 有 direct 的先直连平台官方接口，失败再退回 60s API（字段各端点不同，见 map）。
// 微博官方接口要访客 cookie，本机直连 403，只走 60s。
const SOURCES = {
  weibo:   { path: 'weibo',     name: '微博热搜', map: (i) => ({ title: i.title, heat: i.hot_value || 0, link: i.link || '', desc: '', cover: '' }) },
  baidu:   { path: 'baidu/hot', name: '百度热搜', direct: fetchBaiduDirect, map: (i) => ({ title: i.title, heat: Number(i.score) || 0, link: i.url || '', desc: i.desc || '', cover: i.cover || '' }) },
  douyin:  { path: 'douyin',    name: '抖音热点', direct: fetchDouyinDirect, map: (i) => ({ title: i.title, heat: i.hot_value || 0, link: i.link || '', desc: '', cover: i.cover || '' }) },
  toutiao: { path: 'toutiao',   name: '头条热榜', direct: fetchToutiaoDirect, map: (i) => ({ title: i.title, heat: i.hot_value || 0, link: i.link || '', desc: '', cover: i.cover || '' }) },
  zhihu:   { path: 'zhihu',     name: '知乎热榜', direct: fetchZhihuDirect, map: (i) => ({ title: i.title, heat: 0, link: i.link || '', desc: (i.detail || '').slice(0, 120), cover: i.cover || '' }) },
  // 腾讯新闻热点榜：60s 没有这个源，只能直连（无 path = 不回退 60s）。
  // 每条带百来字摘要，比微博/抖音的一句话词条素材厚。
  qqnews:  { name: '腾讯新闻', direct: fetchQqNewsDirect },
  // 凤凰网不在 60s API 里，自带取数（见 fetchIfengList）。
  // 它和上面五个的性质不同：是新闻流不是热榜，没有热度值，只能按发布时间倒序取。
  // 好处是条目本身经过编辑筛选，比微博热搜的一句话词条更像「一件事」。
  ifengent: { name: '凤凰娱乐', fetch: () => fetchIfengList('https://ent.ifeng.com/star/') },
  // 影视板块：撤档/票房/枪版泄露/回应传闻这类，和站内 star 频道的选题高度重合。
  // 2026-07-29 按「吃瓜向 vs 通稿」口径抽样比过四个凤凰频道（各 20 条）：
  //   star 35%/0%、movie 30%/10%、tv 5%/30%、music 0%/55%、sports 10%/40%。
  // 只收 movie——tv/music/sports 以开机、首映礼、推广曲、赛事通稿为主，
  // 接进来只会稀释选题池（选题只挑 LIMIT 条，噪音会挤掉真热点）。
  ifengmov: { name: '凤凰影视', fetch: () => fetchIfengList('https://ent.ifeng.com/movie/') },
};

async function fetchHotLists() {
  const all = [];
  await Promise.all(
    SOURCE_KEYS.map(async (key) => {
      const src = SOURCES[key];
      if (!src) return console.warn(`[warn] 未知源 ${key}，跳过`);
      try {
        const items = src.fetch ? await src.fetch() : await fetchHot(src);
        for (const item of items) all.push({ source: src.name, ...item });
        console.log(`[sync] ${src.name}: ${items.length} 条`);
      } catch (e) {
        console.warn(`[warn] ${src.name} 拉取失败: ${e.message}`);
      }
    })
  );
  // 热榜源全挂时只剩凤凰两个新闻流，选题会枯竭——2026-08-21 起 60s 官方实例封了本机 IP，
  // 只打 warn 导致一个半月没人发现。这里单独打一条醒目的 error。
  const hotKeys = SOURCE_KEYS.filter((k) => SOURCES[k] && !SOURCES[k].fetch);
  const hotNames = new Set(hotKeys.map((k) => SOURCES[k].name));
  if (hotKeys.length && !all.some((i) => hotNames.has(i.source))) {
    console.error(`[ALERT] 全部热榜源拉取失败（${hotKeys.join(',')}），本轮只剩新闻流选题。检查直连接口与 HOT_API_BASE`);
  }
  return all;
}

// 热榜源：先直连，再按 HOT_API_BASE 顺序逐个试 60s 实例，任一成功即返回。
async function fetchHot(src) {
  const errs = [];
  if (src.direct) {
    try {
      const items = await src.direct();
      if (items.length) return items.slice(0, 20);
      errs.push('direct: 0 条');
    } catch (e) {
      errs.push(`direct: ${e.message}`);
    }
  }
  for (const base of src.path ? CFG.hotApiBases : []) {
    try {
      return await fetch60s(base, src);
    } catch (e) {
      errs.push(`${new URL(base).host}: ${e.message}`);
    }
  }
  throw new Error(errs.join(' | '));
}

async function fetchJson(url, headers = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': IFENG_UA, ...headers }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// 60s API 系（weibo/baidu/douyin/toutiao/zhihu）：统一端点，各自 map 字段
async function fetch60s(base, src) {
  const json = await fetchJson(`${base}/${src.path}`);
  if (json.code !== 200 || !Array.isArray(json.data)) throw new Error(`code=${json.code}`);
  return json.data.slice(0, 20).map(src.map);
}

// ---------- 平台官方热榜接口（直连）----------
// 字段对齐 60s 的 map 输出：{ title, heat, link, desc, cover }。
// 百度 PC 版接口带 desc/热度/配图；置顶条（topContent）不取，与 60s 口径一致。
async function fetchBaiduDirect() {
  const json = await fetchJson('https://top.baidu.com/api/board?platform=pc&tab=realtime');
  const list = json?.data?.cards?.[0]?.content;
  if (!Array.isArray(list)) throw new Error('结构变化：无 data.cards[0].content');
  return list.map((i) => ({ title: i.query || i.word, heat: Number(i.hotScore) || 0, link: i.rawUrl || i.url || '', desc: i.desc || '', cover: i.img || '' }));
}

async function fetchToutiaoDirect() {
  const json = await fetchJson('https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc');
  if (!Array.isArray(json?.data)) throw new Error('结构变化：无 data[]');
  return json.data.map((i) => ({ title: i.Title, heat: Number(i.HotValue) || 0, link: i.Url || '', desc: '', cover: i.Image?.url || '' }));
}

async function fetchDouyinDirect() {
  const json = await fetchJson('https://www.iesdouyin.com/web/api/v2/hotsearch/billboard/word/');
  if (!Array.isArray(json?.word_list)) throw new Error('结构变化：无 word_list[]');
  return json.word_list.map((i) => ({ title: i.word, heat: Number(i.hot_value) || 0, link: `https://www.douyin.com/search/${encodeURIComponent(i.word)}`, desc: '', cover: '' }));
}

// 网页版 www.zhihu.com/api/v3/... 要登录（401），移动端接口免登录。
async function fetchZhihuDirect() {
  const json = await fetchJson('https://api.zhihu.com/topstory/hot-lists/total?limit=20');
  if (!Array.isArray(json?.data)) throw new Error('结构变化：无 data[]');
  return json.data.filter((i) => i.target?.title).map((i) => {
    const m = String(i.detail_text || '').match(/([\d.]+)\s*万/);
    const qid = String(i.target.url || '').match(/questions\/(\d+)/)?.[1];
    return {
      title: i.target.title,
      heat: m ? Math.round(Number(m[1]) * 1e4) : 0,
      link: qid ? `https://www.zhihu.com/question/${qid}` : '',
      desc: String(i.target.excerpt || '').slice(0, 120),
      cover: i.children?.[0]?.thumbnail || '',
    };
  });
}

// 第一条是「腾讯新闻用户最关注的热点，每10分钟更新一次」的榜单说明，没有 url，靠 url 过滤掉。
async function fetchQqNewsDirect() {
  const json = await fetchJson('https://i.news.qq.com/gw/event/pc_hot_ranking_list?ids_hash=&offset=0&page_size=50');
  const list = json?.idlist?.[0]?.newslist;
  if (!Array.isArray(list)) throw new Error('结构变化：无 idlist[0].newslist');
  return list.filter((i) => i.title && i.url).map((i) => ({
    title: i.title,
    heat: Number(i.hotEvent?.hotScore ?? i.readCount) || 0,
    link: i.url,
    desc: String(i.abstract || '').replace(/\s+/g, ' ').slice(0, 120),
    cover: i.thumbnails_big?.[0] || i.thumbnails?.[0] || '',
  }));
}

// ---------- 凤凰网娱乐列表页（ent.ifeng.com/star/、/movie/）----------
// 页面把列表数据以 "newsstream":[...] 的形式内联在 HTML 里，字段齐整（含发布时间和封面），
// 比解析 DOM 稳。只取标题/链接/时间/封面当**选题线索**，不抓正文——
// 抓正文再改写就从「选题参考」变成洗稿了，风险性质完全不同。
const IFENG_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// 从 from 处截出一个配平的 JSON 数组。字符串内的方括号不能参与配平，
// 标题里出现「[]」并不罕见，所以要跟踪引号和转义状态。
function sliceJsonArray(s, from) {
  let depth = 0, inStr = false, esc = false;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '[') depth++;
    else if (c === ']' && --depth === 0) return s.slice(from, i + 1);
  }
  return null;
}

// 凤凰各频道列表页共用同一套内联 newsstream 结构，按 URL 参数化即可复用。
async function fetchIfengList(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': IFENG_UA },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const k = html.indexOf('"newsstream"');
  if (k < 0) throw new Error('页面结构变了：找不到 newsstream');
  const raw = sliceJsonArray(html, html.indexOf('[', k));
  if (!raw) throw new Error('newsstream 数组未配平');
  return JSON.parse(raw)
    .filter((x) => x.type === 'article' && x.title && x.url)
    .slice(0, 20)
    .map((x) => ({
      title: String(x.title).trim(),
      heat: 0, // 新闻流没有热度值，选题 prompt 里会渲染成 '-'
      link: x.url,
      // 只给来源媒体号，不给发布时间：时间对选题没用，却会被模型当成事实写进正文
      // （2026-07-28 实际产出过「发布时间卡得很准, 07-28 09:29」这种句子）。
      desc: (x.source || '').trim(),
      cover: x.thumbnails?.image?.[0]?.url || '',
    }));
}

// ---------- 单实例锁 ----------
// state.json 的去重状态只在每篇入库后才落盘，若两个实例并行（如 cron 跑着时手动又跑一次），
// 后启动的那个会读到尚未更新的状态 → 选中同一个话题 → 产出重复文章（2026-07-27 实际踩到）。
// 用排它创建的锁文件把并发挡住；锁超过 STALE_MS 视为上次崩溃遗留，可接管。
const LOCK_FILE = join(DIR, '.run.lock');
const LOCK_STALE_MS = 60 * 60 * 1000;
const { acquire: acquireLock, release: releaseLock } = createLock(LOCK_FILE, LOCK_STALE_MS);

// ---------- 去重状态 ----------
function loadState() {
  let s;
  try { s = JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { return { done: {} }; }
  // 事件登记表只用于近 7 天避重，留 30 天足够；不清理会随时间无限膨胀。
  if (s.events) {
    const cut = new Date(Date.now() - 30 * 86400000).toISOString();
    for (const [k, v] of Object.entries(s.events)) if (!v?.at || v.at < cut) delete s.events[k];
  }
  return s;
}
function fingerprint(title) {
  return title.replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase().slice(0, 40);
}

// ---------- LLM 后端 ----------
// 生成子进程刻意去权：空目录当 cwd + 关掉所有工具。
// 这一步不是洁癖——2026-07-29 实跑中撞见过：成文那步模型先吐出非法 JSON，
// 「修复」重试的提示词把它带偏，它就以仓库目录为 cwd 跑去读了 index.mjs，
// 回了一段「确认了——不是 bug，是设计如此……fetchIfengList（index.mjs:143-174）」，
// 把代码分析当成文章正文输出。那次靠 JSON 解析失败挡住了（文章没入库），
// 但它当时是带着完整工具权限的，本可以做出文件动作。
// 成文只需要文本进文本出，给它仓库和工具是纯粹多余的攻击面。
const SAFE_CWD = join(tmpdir(), 'hot-sync-gen');
const callClaude = (prompt) => callClaudeLib(prompt, { model: CFG.claudeModel, cwd: SAFE_CWD });

// OpenAI 兼容后端（minimax / wujiai 共用）
const OPENAI_BACKENDS = {
  minimax: () => ({ url: CFG.minimaxUrl, key: CFG.minimaxKey, model: CFG.minimaxModel, name: 'minimax' }),
  wujiai: () => ({ url: CFG.wujiaiUrl, key: CFG.wujiaiKey, model: CFG.wujiaiModel, name: 'wujiai' }),
};

// 按 --backend 选调用函数，重试 / JSON 修复 / 限流中止见 scripts/lib/llm.mjs
function llmJSON(prompt, label) {
  const call = OPENAI_BACKENDS[BACKEND] ? (p) => callOpenAICompat(OPENAI_BACKENDS[BACKEND](), p) : callClaude;
  return llmJSONLib(call, prompt, label);
}

// 采集素材封面图 → 传入 Strapi 媒体库（自存避免防盗链/签名过期）；失败返回 null，文章照常发只是无图
// 上传并返回 { id, url }（url 供正文配图拼 markdown 用）；失败返回 null
const { request: strapi, fetchAllPages, uploadMedia } = createStrapi({ url: CFG.strapiUrl, token: CFG.strapiToken });

async function uploadCover(url, name) {
  const m = await uploadMedia(url, name);
  return m?.id ?? null;
}

// 素材一张图都采不到时的兜底：本地渲染品牌标题卡再上传（见 gen_cover.py 的取舍说明）。
// 与 uploadMedia 分开写，因为它不走网络下载，失败原因和重试语义都不一样。
async function uploadTitleCard(title, slug, channelName) {
  const tmp = join(tmpdir(), `card-${slug}-${process.pid}.jpg`);
  try {
    await new Promise((resolve, reject) => {
      const p = spawn('python3', [join(DIR, 'gen_cover.py'), title, tmp, channelName || ''], { cwd: DIR });
      let err = '';
      p.stderr.on('data', (d) => (err += d));
      p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`gen_cover 退出码 ${c}: ${err.slice(0, 160)}`))));
    });
    const form = new FormData();
    form.append('files', new Blob([readFileSync(tmp)], { type: 'image/jpeg' }), `cover-${slug}.jpg`);
    // alt 用标题：无障碍与图片 SEO 都要，绝不留空
    form.append('fileInfo', JSON.stringify({ alternativeText: title, caption: title }));
    const up = await fetch(`${CFG.strapiUrl}/api/upload`, {
      method: 'POST', headers: { Authorization: `Bearer ${CFG.strapiToken}` }, body: form,
    });
    const json = await up.json();
    if (!up.ok) throw new Error(`upload ${up.status}`);
    return json[0]?.id ?? null;
  } catch (e) {
    console.warn(`[warn] 标题卡生成失败: ${e.message}`);
    return null;
  } finally {
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* 清理失败不影响主流程 */ }
  }
}

// ---------- Strapi REST ----------

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
      '用素材里真有的时间点做小标题（如「7月20日 事情起头」「7月26日 当事人发声」），按时间顺序还原；时间点少就少分几节',
      '末段「目前进展」：写清最新状态；素材里有明确的下一个节点（开庭、上映、复赛、通报时限）就点出来',
    ],
    title: '突出「始末 / 来龙去脉 / 时间线 / 几天几变」，让人一眼知道这是一篇捋清楚的稿',
    ending: '停在最新的确定事实上；有明确的下一个时间节点就点出来，没有就不写「后续」，不许提问、不许喊话读者',
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
    bans: '过往争议只能写素材里出现过的，严禁凭印象补黑历史（法律风险最高的一档，宁可少写）；凑不够条数就少列几条，不要用「公开可查的信息有限」这类话交代',
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
    // 原写「两栏式」，模型会出 markdown 表格，前台渲染器不支持表格，线上显示成裸的 | --- |。
    ending: '以「确定的 / 还只是网传的」两组收尾：各起一行加粗引语（**确定的：** / **还只是网传的：**），下面用「- 」列表逐条列出',
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
      '用 3~5 个问句做小标题（如「XX 到底怎么回事？」「有官方说法吗？」），只问素材答得出的问题，每问答实',
      '最后一问优先问「这事跟普通人有什么关系」或「接下来看什么」，素材撑不起就不设这一问',
    ],
    title: '可用疑问句，但禁止「网友吵翻了」式尾巴',
    ending: '以最后一问的答案收尾，不另写总结',
    bans: '每个问题都要挑素材真答得出的来问——答不出来就换一个能答的问题，不要摆一堆「目前没有公开信息」凑数',
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
    bans: '人物关系只能依据素材，禁止臆测亲属/资金关系；不确定的关系标一次「据网传」即可，不要每提一次就重申一遍未证实',
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
    ending: '收在这段内容为什么被转发上，用自己的话说',
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
  // ↓ 以下 3 个体裁提炼自凤凰网娱乐「明星」板块的长稿写法（ent.ifeng.com/star/）。
  // 学到的四点：① 序号分节 +「短语，疑问？」式小标题；② 每个论断后面跟一个可核的数字
  // （集均播放量/票房/评分/排片/市场占有率）；③ 观众评价必列褒贬两面，不做单边输出；
  // ④ 落点收在行业或群体处境上，不停在个人身上。
  // 刻意没学的一点：原站大量用外貌羞辱当论据（「又老又油」「面部浮肿」），
  // 我们这边法律和口碑风险都不划算，三个体裁的 bans 里都明令禁掉。
  {
    key: 'scorecard', name: '作品成绩单', channels: ['star', 'oversea', 'influencer', 'video'],
    // 选题必须真有「作品 + 成绩」可写。2026-07-28 首次上线当天就踩坑：
    // 「虞书欣工作室 AI 肖像侵权声明」被分到本体裁，通篇在承认「一个数字都没有」。
    // 频道对不代表选题对——这三个新体裁是选题依赖的，不是频道依赖的。
    requires: /剧|影|片|综艺|电影|票房|播放|收视|评分|豆瓣|开播|上映|定档|首播|成绩|战绩|销量|专辑|演唱会|榜/,
    faq: true,
    role: '你是盯作品数据的娱乐观察编辑，读者要的是「这部作品到底成没成，数字说了算」。',
    structure: [
      '导语 4~6 句短句，并列摆出这个人/这部作品最近的几个成绩点（一句一件），末句用一个设问收住，点明本篇要回答什么',
      '用 2~3 个「短语，疑问？」式小标题分节（如「电影票房扑街，比网大还网大？」「新剧开播遭质疑，口碑播放双失利？」）',
      '每节先摆成绩数字（播放量/票房/评分/排片/热度/市场占有率），再写观众评价，褒贬两面都要写到',
      '末段「这份成绩单说明什么」：从数字里读出判断',
    ],
    title: '突出作品名 + 成绩落差，如「上映十天票房只有…」「口碑播放量双失利」',
    ending: '以「作品层面的判断 + 下一部还有什么看点」收尾',
    bans: '数字不许编，但也不要专门声明数据缺失——素材给了数字就用，没给就换个角度写（观众反应、同类对比、讨论焦点），不要写「具体数据未公开」「查无实据」这类交代；褒贬两面都要写到，不许写成单边差评；禁止用长相、身材、年龄、衰老当作评价论据',
  },
  {
    key: 'cohort', name: '一代人切片', channels: ['star', 'influencer', 'sports', 'oversea', 'society'],
    // 必须真的是一批人/一类现象，单人单事套上去会硬凑同类案例
    // 单字「们/花/生」会误中「学生」「花钱」「我们」——2026-10-05 dry-run 把「游客住高校宿舍」单事件判进了本体裁
    requires: /一代|这批|群体|集体|多位|多名|接连|纷纷|扎堆|\d{2}(花|后)|小花|小生|新生代|中生代|顶流们|新人|前辈|同期/,
    role: '你是做群体现象观察的编辑，擅长从一个人身上看出一批人的共同处境。',
    structure: [
      '从眼下这个具体的人或事切入，1 段说清',
      '「不止他一个」：横向摆 2~4 个同一批里的同类案例，每个 80~150 字',
      '「他们共同卡在哪」：从这些案例里找出结构性的共同原因',
      '「上下夹击」：和上一代、下一代或同类竞争者比一比处境',
      '末段：这批人接下来还能往哪走',
    ],
    title: '突出群体名词（如「90 花」「顶流们」「中生代」「初代网红」）+ 处境判断，不用感叹号',
    ending: '以「这批人接下来能走的路」收尾',
    bans: '横向案例只能用素材里真实出现过的人和作品，凑不够就少写一个，严禁虚构第三方案例来撑群体感；群体归因要落在行业和环境上，不得写成对某个人的人身攻击；禁止用长相、身材、年龄、衰老当作论据',
  },
  {
    key: 'arc', name: '口碑曲线', channels: ['star', 'influencer', 'sports', 'oversea', 'history'],
    // 必须真有事业起落可描，突发单一事件套上去会编履历
    requires: /复出|翻红|塌房|过气|转型|回归|退圈|息影|沉寂|巅峰|下滑|翻车|事业|口碑|人气|资源|多年|当年|昔日|再度/,
    faq: true,
    role: '你是跟事业曲线的编辑，读者要看的是「这个人是怎么一步步走到今天这个位置的」。',
    structure: [
      '开头给现在的位置：最近这件事把他推到了什么处境',
      '「最风光的时候」：高光期是什么样、靠什么起来的',
      '「从哪儿开始不对劲」：找出转折点，说清是哪件事、哪部作品',
      '「现在的处境」：眼下的具体表现，用素材里的事实说话',
      '末段「手里还剩哪些牌」',
    ],
    title: '突出落差，如「从…到…」「代表作还停在…」「还有没有翻身的机会」',
    ending: '以「手里还剩哪些牌」收尾，可以给判断但不下定论',
    bans: '高光期和转折点都必须有素材佐证，素材没交代清楚的阶段就跳过不写，禁止凭印象补履历；评价只针对作品和公开言行，禁止用长相、身材、年龄、衰老当作论据，也不得暗示私德问题',
  },
];

// 全局禁令（a02「禁止清单优于笼统要求」）：把已经写滥的套路点名禁掉
const GLOBAL_BANS = [
  '结尾禁止向读者提问或喊话：「你怎么看」「你觉得呢」「评论区聊聊」「欢迎留言」「一起吃瓜」全部禁用——按本篇体裁指定的方式收尾',
  '「据网友讨论」「网传消息称」两个短语全篇各最多出现 1 次；其余归因请换着说：有网友翻出、评论区里、这两天的讨论集中在、多个平台的说法是、爆料帖里提到',
  '标题禁用这些已经用滥的词：网友吵翻了、引热议、网友直呼、全网围观、太魔性、炸了、你敢信、这一幕、意想不到',
  '禁止 AI 腔：不仅…而且、值得注意的是、总的来说、总的来看、综合来看、综上所述、纵观…、在这个…的时代、让我们、首先/其次/最后 的三段式、无实义的排比句',
  '禁止自称：本文、笔者、小编、我们编辑部',
  '句子要短，多用口语的短句；不要每段都用「其实」「说白了」「不得不说」开头',
  '正文里不要出现「梳理一下」「先来看看」这类流程性套话，直接进入内容；导语不以「近日」「据悉」「日前」「最近」开头',
  '排版只用这几种 markdown：## 小标题、「- 」无序列表、「1. 」有序列表、**加粗**、[链接](路径)；禁止表格（| 竖线 |）、引用块（>）、分隔线（---）、代码块——前台不支持，会显示成乱码',
  '不要反复声明信息缺失：「具体数据未公开」「素材未提及」「查无实据」「暂无更多信息」这类交代全篇最多 1 次；素材里没有的东西直接不写，换能写的角度展开，别把「我没有资料」写成内容',
].map((s, i) => `${i + 1}. ${s}`).join('\n');

// 默认 prompt（单一事实来源在此；后台「热榜二创配置」字段为空时首跑会自动填入，之后以后台为准）
const DEFAULT_PICK_PROMPT = `你是吃瓜资讯站「今日吃瓜」的选题编辑。以下是当前各平台热榜（编号. [来源] 标题 | 热度 | 补充说明）：

{{topics}}

本站最近 7 天已经写过的文章如下（同一事件不要再写第二遍）：

{{covered}}

从中选出最多 {{limit}} 个适合本站的选题。硬性规则：
- 只选「吃瓜向」：明星/网红/影视综艺/社会趣闻/体育人物/海外热点/情感话题等大众娱乐谈资
- 必须排除：时政、政府政策、领导人、军事外交、民族宗教、重大灾难伤亡、疫情防控等严肃或敏感议题
- 同一事件在多个榜单出现的，合并为一个选题（refs 列出所有相关编号）
- 素材厚度：补充说明为「-」的条目只有一行标题，单独写不出有信息量的稿子。只有在同一事件另有带补充说明的条目可以合并时才选，否则跳过——宁可少选
- 【避免重复选题·最重要】每个选题必须给出 eventKey：该事件的稳定标识，用「核心当事人/作品 + 核心动作」概括成 4~12 个汉字，不带任何情绪词和角度词。
  例：「詹姆斯加盟76人」「李权哲高铁占座」「菲尔兹奖2026」「正颌手术做反」。
  同一件事无论从哪个角度写、无论出现在哪个榜单，eventKey 都必须完全一致；
  上面已写文章里若已标出 eventKey，命中同一事件时必须原样复用那个 key，不要另起一个。
- 上面「已经写过的文章」覆盖的事件，默认一律不许再选。只有同时满足下面两条才可以追更：
  ① 出现了实质性新进展——官方通报/权威结论、当事人首次回应、剧情反转、法律或行政处理结果；
     热度上涨、换个角度、又有网友讨论、更多细节流出，都不算新进展；
  ② 你能在 newDevelopment 里用一句话说清「新在哪、跟旧文差在哪」。
  满足就把 followUp 设为 true、prevPath 填上面那篇旧文的路径；不满足就换别的选题。
  宁可少选几篇，也不要把同一件事写第二遍——站内同题内容对 SEO 是负分。
- 本批内部同样不许重复：两个选题的 eventKey 不得相同（跨榜单是同一件事就合并成一个）
- 每个选题从以下频道中选最贴切的一个：
{{channels}}
- angle（切入角度）本批之间必须各不相同：不要所有选题都写成「争议/网友吵翻」一个路子。可用的角度类型举例：还原过程、核实真假、扒背景关系、对比同类事件、当事人回应、围观者反应、行业视角、旧事重提。同一批里同一种角度类型最多用 2 次

只输出 JSON 数组，不要任何其他文字：
[{"topic":"选题概括(一句话)","angle":"吃瓜切入角度(一句话)","channelSlug":"频道slug","eventKey":"事件稳定标识","followUp":false,"newDevelopment":"","prevPath":"","refs":[相关条目编号]}]`;

const DEFAULT_WRITE_PROMPT = `【角色】
{{styleRole}}
你在为吃瓜资讯站「今日吃瓜」供稿，读者是刷手机看热闹的普通网友。他们已经在热榜上看过标题，点进来是想多知道点东西。

【任务】
用下面的素材写一篇原创资讯，体裁为「{{styleName}}」，正文 {{length}} 字。篇幅跟着素材走：料少就写短写实，宁短勿水。

选题：{{topic}}
切入角度：{{angle}}
{{followUp}}
【素材】（唯一事实依据，素材之外的具体人和事一律不写）
{{refs}}

【动笔前】先在 facts 字段里把素材拆成事实清单，每条一句话、末尾注明出自哪条素材（如「[微博热搜]」）：
- 谁、何时、何地、发生了什么、结果如何、各方怎么说
- 不同素材说法对不上的，单列一条「说法不一」，把两边都记下来
正文只能用这份清单里的事实。清单里没有的东西，正文里也不该出现。

【这篇要给读者什么】
- 导语一句话交代核心事实：谁、做了什么或遇到了什么、结果怎样。不以「近日」「据悉」「日前」「最近」开头，不铺垫。
- 不按素材顺序逐条改写。按「最新进展 → 关键细节 → 来龙去脉」重新组织，读者最想知道的放最前面。
- 写出比热榜标题多的东西：这事是怎么来的、为什么现在被讨论、跟普通人有什么关系、和同类事情比有什么不同——只挑素材撑得起的写，撑不起就不写。
- 事实和判断分开。转述事实就平实地说；编辑自己的判断要让读者看得出是判断，用「从时间线看」「这意味着」「换句话说」这类自然的说法带出来，不要写「这是编辑的判断」「以下是判断」这种声明句；判断要有依据，可以有观点，但不定性、不定罪。
- 关键事实交代出处，用自然的说法带出来（如「微博热搜词条的说法是」「知乎热榜的问题描述里提到」），不要在句尾堆括号批注。
- 几个来源说法不一致的，如实写「A 的说法是……，B 则称……」，不替任何一方裁决。
- 当事人原话：素材里有的，原样放进「」并写明是谁说的，引号里一个字都不改；拿不准原话的就改成转述，不加引号。
- 专业名词、圈内说法第一次出现时，用半句话解释清楚。只解释概念本身，不借机补充本事件素材里没有的细节。

【结构】按「{{styleName}}」的骨架写，不要套用其他体裁：
{{styleStructure}}
- 标题写法：{{styleTitle}}
- 收尾方式：{{styleEnding}}
骨架是方向不是模板：某一节素材撑不起就合并或跳过，不要为了凑齐小节去写空话。骨架和收尾方式里加引号的词只是示意，用自己的话写出那个意思，不要原样抄成句子或小标题。

【约束】
- 事实纪律（最重要）：素材没有的具体人名、数字、时间、引语一律不得编造；不诽谤、不定罪，争议事件中立转述。
  注意分寸：不编造 ≠ 要反复声明缺什么。素材没有的内容直接不写，关键的未证实信息全篇标一次就够；不要写「素材未提及」「数据未公开」「仍待回应」这类话——那是另一种套话。
- 本体裁专属禁令：{{styleBans}}
- 全局禁令（违反任意一条都算不合格）：
{{bans}}
- 最近已经发过的写法如下，本篇的标题句式和开头必须与它们明显不同：
{{recent}}
- 读起来要像人写的：长短句交替，段落有长有短，可以单句成段；打散整齐的排比和「一二三」式的对仗；保留有信息量的判断，不要磨成四平八稳的中性话；不写总结段。
- 语气像懂行的朋友在聊，不低俗、不油腻；移动端短段落，每段不超过 4 行。
- 正文用「## 小标题」分段，至少 2 个；小标题写具体信息（如「10月3日晚的那条动态」），不用「事件经过」「网友热议」这类空标题。outline 里列的小标题要真的写进正文。
- 正文中自然嵌入 2~3 条站内链接，markdown 格式：[锚文本](/频道/slug)
  · 路径**只能**从下面「可链接文章」里原样复制，一个字符都不能改，严禁自己编造路径
  · 锚文本是句子里的自然短语（如「此前那起校园争议」），禁止「点击这里」「查看详情」
  · 链接放在语义相关处，不要堆在结尾
  可链接文章（路径必须原样复制）：
{{links}}
{{faqBlock}}
- summary ≤120 字，不要复读标题
- slug：英文小写连字符，2~3 个词，尽量短（SEO 用）
- tags：3~5 个，name 中文、slug 英文小写连字符。**必须优先从下面「可复用标签库」里选**，尽量全部命中；标签要用「可跨事件复用的话题词/品类词」(如 明星、恋情、塌房、综艺、体育)，**不要用一次性的具体人名或单一事件词做标签**(如 某某某、某活动名)——那会产生只有一篇的孤岛标签页。最多只允许出现 1 个库里没有的新标签，且该新标签也必须是能被后续文章复用的通用词。
  可复用标签库(优先复用)：{{taglib}}
- seo.metaTitle ≤60 字符
- seo.metaDescription **70~90 个汉字**（这是搜索结果里的摘要位，超过约 90 字会被截断）：一句话交代事件核心与看点，自然融入关键词；只写已知事实，不卖关子，不写交代缺失信息的话
- seo.keywords 逗号分隔 3~5 个中文词
- 标题 ≤30 字，核心关键词（人名/作品/事件）放在前半段；可以有看点，但不夸张失实、不做标题党

【格式】
先写 facts，再在 outline 里列小标题草案（2~5 条，按素材多少定），最后照着写 content——先拆事实、再列提纲、最后成文。
首段自然出现 seo.keywords 的第一个关键词，不要为塞词而生硬。

只输出 JSON，不要任何其他文字。注意：content 里的换行必须转义为 \\n；标题和正文中一律使用中文引号「」或书名号《》，禁止出现英文双引号字符，确保整体是合法 JSON：
{"facts":["事实1 [来源]","事实2 [来源]"],"outline":["小标题1","小标题2"],"title":"...","slug":"...","summary":"...","content":"markdown正文","tags":[{"name":"...","slug":"..."}],"seo":{"metaTitle":"...","metaDescription":"...","keywords":"..."}}`;


// ---------- 套话自检（prompt 约束不够硬，出稿后再机器校一遍）----------
const BODY_BANS = [
  { re: /(你怎么看|你觉得呢|你怎么想|评论区(聊聊|见|等你|说说)|欢迎留言|一起吃瓜)/, msg: '向读者提问/喊话' },
  // 「总的来看/综合来看/纵观」是凤凰式长稿的收尾口头禅，与「总的来说」同源，
  // 引入 scorecard/cohort/arc 三个体裁后会跟着进来，一并挡掉。
  { re: /(不仅.{0,12}而且|值得注意的是|总的来(说|看)|综合来看|综上所述|纵观[^，。]{0,8}，|在这个.{0,10}时代|让我们一起)/, msg: 'AI 腔套话' },
  { re: /(本文|笔者|小编)/, msg: '禁止自称' },
  { re: /(梳理一下|先来梳理|先来看看|让我们来看)/, msg: '流程性套话' },
  // 前台 apps/web/lib/markdown.tsx 不支持这些语法，漏过去就是裸标记上线
  { re: /^\s*\|.*\|\s*$/m, msg: '用了 markdown 表格（前台不支持，改用「- 」列表）' },
  { re: /^\s*(>|```|-{3,}\s*$)/m, msg: '用了引用块/代码块/分隔线（前台不支持）' },
];
const TITLE_BANS = /(网友吵翻|引热议|网友直呼|全网围观|太魔性|炸了吗?|你敢信|这一幕|意想不到)/;
// 频次限制（不是禁用）：这些短语本身没错，写多了才变成套话。
// 「数据未公开」类是 2026-07-28 实跑暴露的——过紧的事实纪律逼出了满篇缺失声明。
const HEDGE_LIMIT = {
  据网友讨论: 1,
  网传消息称: 1,
  具体数据未公开: 1,
  素材未提及: 1,
  查无实据: 1,
  暂无更多信息: 1,
  没有公开信息: 2,
  // 2026-10-05 对照试跑暴露：前者是旧禁令里推荐的替代说法，后者是「明示判断」被照字面执行
  公开的信息只到: 0,
  编辑的判断: 0,
  以下是判断: 0,
  这是判断: 0,
  '判断，不是': 0,
};

// ---------- 近重复守卫 ----------
// 热榜同一事件换个说法会二次上榜，指纹去重（按标题原文）挡不住；
// 2026-07-27 实际出现过「痞幼…能自证吗」与「痞幼…经得起求证吗」两篇几乎同题。
// 这里用字符二元组 Jaccard 相似度，跟近期已发标题比一遍。

// 体裁模板词：由 WRITE_STYLES 的「标题写法」批量生产，与事件本身无关。
// 留在串里会制造两类错判：① 两篇毫不相干的文章仅凭同一个后缀就被判重复
// （实测「患癌老太打赏男主播…评论区吵翻了」vs「70岁保洁阿姨被判替女还债…评论区吵翻了」
// 原始相似度 0.188，比多数真重复还高）；② 真重复的分子被模板词稀释而压到阈值以下。
// 比相似度前先剥掉，信号噪声比会明显变好（见下方阈值说明）。
const TITLE_TPL = /(网友(直呼|吵翻了?|热议|都在|玩梗|们?说)?|评论区(吵翻了?|见)?|引(发)?(热议|围观|争议|论战|全网关注)|上了?热搜|冲上热搜|刷屏|吵翻了?|两派(吵起来了?|吵开|各说各话)|全网|始末|背后|起底|扒一扒|一次说清|说清了?吗|捋清楚|厘清|真的吗|到底是?怎么回事|这(事|几个问题|个疑问)|几个(问题|疑问)|先(捋|厘)|为什么|咋样|来了|突然|疑似|传闻|曝光|细节|档案|真相|问得最多|还没人正面回应)/g;
function stripTpl(s) {
  return String(s || '').replace(TITLE_TPL, '');
}

const similarity = bigramJaccard;
// 阈值 0.15（剥模板词之后）：用全量 376 条历史标题重新跑过分布。
// 旧口径（原始标题 + 0.30）实测只抓到 6% 的真重复——因为 writePrompt 会把「最近已用写法」
// 注入禁令，主动逼模型把标题写得不像，守卫等于在跟提示词对着干。
// 剥掉模板词后两类分离得很干净：无关对 0.00~0.07，真重复 0.13~0.24
// （詹姆斯 0.23、敬一丹 0.24、李权哲 0.20、正颌 0.13）。
// 注意这一层只是兜底：同事件不同角度（菲尔兹奖「北大同学获奖」vs「南开老师陪跑」= 0.10）
// 字符串永远追不上，那类靠 coveredBlock 在选题阶段拦（见下）。
const DUP_THRESHOLD = 0.15;

async function findNearDuplicate(title, n = 120) {
  try {
    const res = await strapi(`/articles?sort=createdAt:desc&pagination[pageSize]=${n}&fields[0]=title&fields[1]=slug`);
    let best = null;
    const mine = stripTpl(title);
    for (const a of res.data || []) {
      const score = similarity(mine, stripTpl(a.title));
      if (score >= DUP_THRESHOLD && (!best || score > best.score)) best = { title: a.title, slug: a.slug, score };
    }
    return best;
  } catch (e) {
    console.warn(`[warn] 近重复检查失败（跳过）: ${e.message.slice(0, 60)}`);
    return null;
  }
}

// ---------- 已写事件登记表（选题阶段的主防线）----------
// 字符串相似度治不了真正的病灶：同一事件连写 5 天、每天换个角度换套说法，
// 标题之间几乎没有公共子串（菲尔兹奖 11 篇 / 詹姆斯 10 篇 / 李权哲 6 篇都是这么来的）。
// 唯一能识别「这还是那件事」的环节是选题 LLM——但它此前对已发内容一无所知。
// 这里把近 EVENT_COOLDOWN_DAYS 天写过的事件喂回选题提示词，并要求模型给每个选题
// 标一个稳定的 eventKey，落库后记进 state.events，形成跨轮次记忆。
const EVENT_COOLDOWN_DAYS = 7;

function eventKeyOf(s) {
  return String(s || '').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase().slice(0, 24);
}

// 近期已覆盖事件：以站内实际文章为准（自带种子，无需回填历史 eventKey），
// 再并上 state.events 里已知的 eventKey，让模型能原样复用同一个 key。
async function fetchCoveredEvents(state, days = EVENT_COOLDOWN_DAYS) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const byKey = new Map();
  for (const [k, v] of Object.entries(state.events || {})) {
    if (v?.at >= since) byKey.set(k, { key: k, title: v.title, path: v.path, at: v.at });
  }
  try {
    const res = await strapi(`/articles?sort=createdAt:desc&pagination[pageSize]=100&filters[createdAt][$gte]=${since}&fields[0]=title&fields[1]=slug&fields[2]=createdAt&populate[channel][fields][0]=slug`);
    for (const a of res.data || []) {
      const key = eventKeyOf(a.title);
      if (byKey.has(key)) continue;
      // 已在 state.events 里登记过同一篇（按 path 认）就不重复列
      const path = `/${a.channel?.slug || 'news'}/${a.slug}`;
      if ([...byKey.values()].some((v) => v.path === path)) continue;
      byKey.set(key, { key: '', title: a.title, path, at: a.createdAt });
    }
  } catch (e) {
    console.warn(`[warn] 已写事件拉取失败（选题去重降级为仅本地记录）: ${e.message.slice(0, 60)}`);
  }
  return [...byKey.values()].sort((a, b) => (a.at < b.at ? 1 : -1));
}

function renderCovered(covered) {
  if (!covered.length) return '（近期无已发文章）';
  return covered
    .map((c) => `- ${c.at.slice(5, 10)}｜${c.title}｜${c.path}${c.key ? `｜eventKey=${c.key}` : ''}`)
    .join('\n');
}

// 选题 LLM 会漏——它可能忘了 eventKey、或者认不出换了说法的同一件事。
// 这里再机器过一遍：eventKey 是「当事人+动作」的核心短语，通常会原样出现在旧文标题里，
// 所以「归一化后旧标题包含 eventKey」是一条命中率很高的确定性规则。
function coveredHit(pick, covered) {
  const key = eventKeyOf(pick.eventKey || pick.topic);
  if (!key) return null;
  for (const c of covered) {
    if (c.key && c.key === key) return c;
    const t = eventKeyOf(c.title);
    // 包含判定要求两边都够长：短串（「视频」这种）互相包含纯属偶然，会误伤无关选题
    if (key.length >= 4 && t.length >= 4 && (t.includes(key) || key.includes(t))) return c;
    if (similarity(stripTpl(key), stripTpl(t)) >= DUP_THRESHOLD) return c;
  }
  return null;
}

// 追更是否成立：必须说得清「新在哪」。只写「热度持续」「网友继续讨论」不算。
function validFollowUp(pick) {
  const nd = String(pick.newDevelopment || '').trim();
  if (!pick.followUp || nd.length < 8) return false;
  return !/^(热度|持续|继续|网友|更多细节|讨论|发酵|关注度)/.test(nd);
}

function dropCoveredPicks(picks, covered) {
  const out = [];
  const batchKeys = new Map();
  for (const p of Array.isArray(picks) ? picks : []) {
    const key = eventKeyOf(p.eventKey || p.topic);
    // 批内跨源去重：同一件事在微博/抖音/头条各上一次榜，模型偶尔会当成三个选题
    if (key && batchKeys.has(key)) {
      console.warn(`[dup-pick] 「${p.topic}」与本批「${batchKeys.get(key)}」是同一事件(${key})，合并丢弃`);
      continue;
    }
    const hit = coveredHit(p, covered);
    if (hit) {
      if (!validFollowUp(p)) {
        console.warn(`[dup-pick] 「${p.topic}」与已发《${hit.title}》同事件，且无实质新进展，跳过`);
        continue;
      }
      // 追更放行：把旧文路径带下去，成文时强制内链回旧文，形成话题聚合而不是同题竞争
      p.prevPath = p.prevPath || hit.path;
      p.prevTitle = hit.title;
      console.log(`[follow-up] 「${p.topic}」追更《${hit.title}》——新进展：${p.newDevelopment}`);
    }
    if (key) batchKeys.set(key, p.topic);
    out.push(p);
  }
  return out;
}

// 数字核对（替代人工「改动自查」）：正文里出现的数字必须能在素材里找到。
// 只查 ≥10 的数、小数和百分比——个位数多是「三件事」「第 2 次」这类叙述用语，误报多于收益。
// 允许来源：素材标题/摘要、选题/角度/新进展、内链候选标题（锚文本可能引用它们），以及今年/去年年份。
function lintFacts(art, sel, refs, links = []) {
  const year = new Date().getFullYear();
  const allowed = [
    ...refs.map((r) => `${r.title || ''} ${r.desc || ''}`),
    sel.topic, sel.angle, sel.newDevelopment,
    ...links.map((l) => l.title),
    String(year), String(year - 1),
  ].join(' ');
  const known = new Set(allowed.match(/\d+(?:\.\d+)?/g) || []);
  const body = String(art.content || '')
    .replace(/\]\([^)]*\)/g, ']')        // 链接/图片地址
    .replace(/^\s*\d+[.)]\s+/gm, '');      // 有序列表序号
  const unknown = [...new Set(body.match(/\d+(?:\.\d+)?%?/g) || [])]
    .map((x) => x.replace('%', ''))
    .filter((x) => (Number(x) >= 10 || x.includes('.')) && !known.has(x));
  if (!unknown.length) return [];
  return [`正文出现素材里没有的数字：${unknown.slice(0, 6).join('、')}——素材没给的数字一律删掉或改成不带数字的说法`];
}

// SEO 结构自检（对齐 p045 发布后检查清单 + p108 修复后检查标准 + p111 FAQ）
function lintSeo(art, style) {
  const v = [];
  const c = String(art.content || '');
  const heads = (c.match(/^##+ /gm) || []).length;
  if (heads < 2) v.push(`小标题不足（${heads} 个，需 ≥2）`);
  const links = [...c.matchAll(/\]\((\/[^)]+)\)/g)].length;
  if (links < 2) v.push(`站内链接不足（${links} 条，需 2~3）`);
  // metaDescription 不在这里查：模型初稿几乎篇篇偏短，放这里会让每篇都整篇重写一次（调用量翻倍），
  // 改由 fixMetaDescription 单独补写这一个字段。
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

// 中文搜索结果摘要位大约只显示 80 字上下，120~160 是英文字符口径，套到汉字上后半截全被截断，
// 模型为凑字数还会补「未提及/仍待回应」式尾巴。目标 70~90 字，100 字为硬上限。
const META_MIN = 70;
const META_MAX = 100;
function metaDescLen(art) {
  return String(art.seo?.metaDescription || '').length;
}

// 交代「缺什么信息」的句子：放在摘要位里是纯套话（见项目 CLAUDE.md 内容口径）
const META_HEDGE = /未提及|并未(展开|说明|透露|公布|回应)|尚未(回应|公布|说明|透露)|仍待|有待|暂未|暂无|尚不清楚|不做推测|仍要看|目前都还没有/;

// 零 LLM 整理：去掉套话句，按句末标点截到 META_MAX 以内。截不出 META_MIN 就原样返回，交给补写。
function tidyMetaDescription(desc) {
  const d = String(desc || '').trim();
  const segs = d.split(/(?<=[。！？!?])/).map((s) => s.trim()).filter(Boolean);
  let out = '';
  for (const s of segs) {
    if (META_HEDGE.test(s)) continue;
    if (out.length + s.length > META_MAX) break;
    out += s;
  }
  return out.length >= META_MIN ? out : d;
}

function metaDescOk(d) {
  const s = String(d || '');
  return s.length >= META_MIN && s.length <= META_MAX && !META_HEDGE.test(s);
}

// metaDescription 不达标时只补写这一个字段，不动正文。最多试 2 次，仍不达标就保留原值（不阻塞发布）。
async function fixMetaDescription(art) {
  const body = String(art.content || '').replace(/[#*\[\]()!]/g, '').replace(/\n+/g, ' ').slice(0, 1200);
  for (let i = 1; i <= 2; i++) {
    try {
      const r = await llmJSON(`为下面这篇资讯写一段搜索结果摘要（meta description）：70~90 个汉字，一段话，`
        + `只依据正文事实，不编造，自然带上关键词「${String(art.seo?.keywords || '').split(/[,，]/)[0] || ''}」，不要复读标题。`
        + `只写已知的事实和看点，不要写交代信息缺失的句子（如「未提及」「仍待回应」「暂未公布」）。\n\n`
        + `标题：${art.title}\n正文：${body}\n\n只输出 JSON：{"metaDescription":"..."}`, `补写摘要「${art.title}」`);
      const d = tidyMetaDescription(normalizePunct(String(r?.metaDescription || '').trim()));
      if (metaDescOk(d)) {
        art.seo = { ...(art.seo || {}), metaDescription: d };
        return true;
      }
      console.warn(`[meta] 「${art.title}」补写第 ${i} 次长度 ${d.length}，不达标`);
    } catch (e) {
      if (e.message.startsWith('RATE_LIMIT')) throw e;
      console.warn(`[meta] 补写失败: ${e.message.slice(0, 80)}`);
    }
  }
  return false;
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

// 文末导流到 jrcg365.com。规则：每个自然日（北京时间）只有最先发布的 OUTBOUND_DAILY_CAP 篇
// 带导流，每篇只随机挂 1 句；草稿不挂。同域同锚文本每篇都堆、每天几十篇，容易被判成链接农场。
// 前台对该域放行 dofollow（apps/web/lib/markdown.tsx 的 DOFOLLOW_HOSTS）。
const OUTBOUND_URL = 'https://jrcg365.com/';
const OUTBOUND_DAILY_CAP = 8;
const OUTBOUND_LINES = [
  '更多热点爆料与实时更新，可继续查看👉👉 [今日吃瓜网](URL)',
  '想看更多同类内容，可以进入👉👉 [今日吃瓜网](URL) 获取最新整理。',
  '本篇内容将持续关注，更多后续进展可前往👉👉 [今日吃瓜网](URL)',
  '更多热门话题、网红动态与娱乐八卦，推荐访问👉👉 [今日吃瓜](URL)',
  '如果你想继续浏览最新吃瓜合集，可以点击👉👉 [今日吃瓜](URL)',
  '相关内容会持续更新，更多完整信息可查看👉👉 [今日吃瓜网](URL)',
  '想第一时间掌握更多热门事件，可以收藏👉👉 [今日吃瓜网](URL)',
  '更多吃瓜内容、爆料合集与实时更新，尽在👉👉 [今日吃瓜网](URL)',
];

// 今天（北京时间 0 点起）还能挂几篇。按已发布正文里是否含该域计数，所以手工发的带链文章也算额度。
// 查询失败按 0 处理：宁可当天少挂，也不因计数失灵每篇都挂。
async function fetchOutboundQuota() {
  const dayStart = new Date(Math.floor((Date.now() + 8 * 3600e3) / 86400e3) * 86400e3 - 8 * 3600e3);
  try {
    const res = await strapi('/articles?status=published&pagination[pageSize]=1&fields[0]=title'
      + `&filters[publishedAt][$gte]=${dayStart.toISOString()}`
      + `&filters[content][$contains]=${encodeURIComponent('jrcg365.com')}`);
    const used = Number(res?.meta?.pagination?.total ?? NaN);
    if (!Number.isFinite(used)) throw new Error('no pagination.total');
    return Math.max(0, OUTBOUND_DAILY_CAP - used);
  } catch (e) {
    console.warn(`[outbound] 今日导流额度查询失败，本轮不挂：${e.message}`);
    return 0;
  }
}

function appendOutbound(content) {
  const c = String(content || '');
  if (c.includes(OUTBOUND_URL)) return c;
  const line = OUTBOUND_LINES[Math.floor(Math.random() * OUTBOUND_LINES.length)];
  return `${c}\n\n${line.replace('(URL)', `(${OUTBOUND_URL})`)}`;
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
  const lead = c.split('\n').map((s) => s.trim()).find((s) => s && !s.startsWith('#') && !s.startsWith('!')) || '';
  const lm = lead.match(/^(近日|据悉|日前|最近|近期)/);
  if (lm) v.push(`导语以「${lm[1]}」开头——第一句直接交代核心事实`);
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
  const topicText = `${sel.topic ?? ''} ${sel.angle ?? ''}`;
  const fit = WRITE_STYLES.filter(
    (s) =>
      (s.channels === '*' || s.channels.includes(sel.channelSlug)) &&
      // 选题门槛：频道对不代表选题对（见 requires 的说明）
      (!s.requires || s.requires.test(topicText)),
  );
  const pool = fit.length ? fit : WRITE_STYLES;
  const fresh = pool.filter((s) => !recent.includes(s.key) && !usedThisRun.has(s.key));
  const cand = fresh.length ? fresh : pool.filter((s) => !usedThisRun.has(s.key));
  const list = cand.length ? cand : pool;
  return list[Math.floor(Math.random() * list.length)];
}

// ---------- 站内主题补位选题 ----------
// 热榜去重后新话题不够时的兜底：把站内同标签的多篇已发文章聚合成一篇盘点。
// 刻意不做「换壳重写」（p112 的做法，已判定不采纳——那是站内重复内容）。
// 2026-09-08 起默认关闭，只在 --fill-only 时跑：实际产出与「换壳重写」没有本质区别——
// 会把同一轮刚发的文章当成员再讲一遍（/star/jiankang-sanjian 复述了 4 小时前的
// /star/zhengpeipei-juannao），且「盘点」「辟谣」「通稿」这类体裁标签也会被当主题盘。
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
  return `- 正文末尾加一个 FAQ 小节（3~5 问）：问题必须是读者真会去搜的具体问题；只挑素材答得出的来问，答不出的换一个，不要用「目前没有公开信息」凑条数；每问 2~3 行
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
- seo.metaDescription 70~90 个汉字（以本条为准，覆盖上文任何其他长度要求），不写交代缺失信息的话；seo.keywords 3~5 个`;

// 从后台「热榜二创配置」拉 prompt；字段为空则回填默认值（仅填空缺，不覆盖后台手改），读取失败回退内置
async function loadPrompts() {
  if (LOCAL_PROMPT) {
    console.log('[cfg] --local-prompt：本轮使用脚本内置 prompt，不读写后台');
    return { pick: DEFAULT_PICK_PROMPT, write: DEFAULT_WRITE_PROMPT };
  }
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

// 后台存的选题 prompt 若是旧版（没有 {{covered}} 占位符），运行时补挂避重规则，
// 保证不用先跑 --upgrade-prompt 也能立刻生效（与 SEO_APPENDIX 同一套路）。
const DEDUP_APPENDIX = `

【避免重复选题（本轮追加规则，优先级高于上文）】
本站最近 7 天已经写过的文章：
{{covered}}

- 每个选题必须给出 eventKey：该事件的稳定标识，用「核心当事人/作品 + 核心动作」概括成 4~12 个汉字，
  不带情绪词和角度词（例：詹姆斯加盟76人、李权哲高铁占座、菲尔兹奖2026）。
  同一件事无论换什么角度、出现在哪个榜单，eventKey 必须完全一致；上面若已标出 eventKey 就原样复用。
- 上面已覆盖的事件默认不许再选。只有「出现实质性新进展（官方通报/当事人首次回应/反转/处理结果）」
  且能在 newDevelopment 里说清新在哪，才可以追更——此时 followUp=true、prevPath 填旧文路径。
  热度上涨、换个角度、更多细节流出都不算新进展。宁可少选，也不要同题写两遍。
- 本批内部两个选题的 eventKey 不得相同。
- 输出对象需包含："eventKey":"事件稳定标识","followUp":false,"newDevelopment":"","prevPath":""`;

function pickPrompt(prompts, topics, n, covered = []) {
  let tpl = prompts.pick;
  if (!tpl.includes('{{covered}}')) tpl += DEDUP_APPENDIX;
  return render(tpl, {
    topics: topics.map((t, i) => `${i}. [${t.source}] ${t.title} | ${t.heat || '-'} | ${t.desc || '-'}`).join('\n'),
    limit: String(n),
    covered: renderCovered(covered),
    channels: CHANNELS_DESC.map(([s, d]) => `  ${s}: ${d}`).join('\n'),
  });
}

// 素材信息量：热榜条目只有「标题 + ≤120 字摘要」，微博/抖音/头条连摘要都没有。
// 固定要 900~1500 字时，缺的那部分只能靠套话和「未公开」声明去填——篇幅改为跟着素材走。
function materialChars(refs) {
  return refs.reduce((n, r) => n + String(r.title || '').length + String(r.desc || '').length, 0);
}
function lengthFor(refs) {
  const n = materialChars(refs);
  if (n < 120) return '500~800';
  if (n < 300) return '700~1100';
  return '900~1400';
}
// FAQ 只在素材够用时要求：料少还硬凑 3~5 问，只会问出一串「目前没有公开信息」
const FAQ_MIN_MATERIAL = 300;

// 追更篇：把选题阶段判定的「新进展」交给成文，否则成文会把旧事从头再讲一遍
function renderFollowUp(sel) {
  if (!sel.followUp && !sel.prevPath) return '';
  const nd = String(sel.newDevelopment || '').trim();
  return `本篇是追更${sel.prevTitle ? `（前文《${sel.prevTitle}》）` : ''}：${nd ? `新进展是「${nd}」。` : ''}`
    + '先写新进展本身，旧事用一两句带过并链回前文，不要把前文重写一遍。\n';
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
    length: lengthFor(refs),
    followUp: renderFollowUp(sel),
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
  const covered = FILL_ONLY ? [] : await fetchCoveredEvents(state);
  if (covered.length) console.log(`[covered] 近 ${EVENT_COOLDOWN_DAYS} 天已写 ${covered.length} 篇，作为避重清单注入选题`);
  let picks = [];
  if (FILL_ONLY) {
    console.log('[fill-only] 跳过热榜选题，只跑站内主题盘点');
  } else if (fresh.length) {
    const raw = await llmJSON(pickPrompt(prompts, fresh, LIMIT, covered), '选题');
    picks = dropCoveredPicks(raw, covered).slice(0, LIMIT);
    console.log(`[pick] 选出 ${picks.length} 个选题：${picks.map((p) => p.topic).join(' / ')}`);
  } else {
    console.log('[dedup] 热榜无新话题');
  }

  // 3b. 站内盘点补位：默认关闭，热榜不够就少发几篇（理由见 buildFillPicks 上方注释）
  const fills = FILL_ONLY ? await buildFillPicks(LIMIT - picks.length, state) : [];
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
  const words = [...new Set([...SENSITIVE_BUILTIN, ...sensWords.map((w) => w.word).filter(Boolean)])];
  // 标签治理（防孤岛）：已存在标签集合 + 推荐复用清单（按使用频次降序）注入 prompt，
  // 引导 LLM 优先复用；配合入库时「每篇最多新建 1 个标签」的硬约束（见下方）。
  const existingTagSet = new Set(allTags.map((t) => t.name));
  // 推荐复用清单：把整个标签库都给模型挑（原先只给前 60 个按使用频次排的，
  // 词表外的一律靠它现编，是标签越长越多的一个来源）。
  // 零文章标签也要进清单——tag-vocabulary.json 那批预置品类词
  // （演员/导演/绯闻/带货/主播/转会/霸凌/饭圈/超话/职场/探班…）本来就是备着给出稿挑的，
  // 挂上之后才会长出聚合页；把它们挡在清单外等于逼模型现编同义新词。
  // 排序上仍把「已经有文章在用的」放前面，让模型优先往已成形的话题上聚。
  const tagLib = allTags
    .map((t) => ({ name: t.name, n: t.articles?.count ?? 0 }))
    .sort((a, b) => b.n - a.n)
    .map((t) => t.name);

  // 5. 逐选题生成 + 入库（一篇一体裁，轮换 + 最近写法作为动态禁令）
  const recentSignals = await fetchRecentSignals(20);
  const usedStyles = new Set();
  let outboundLeft = DRY ? 0 : await fetchOutboundQuota();
  console.log(`[outbound] 今日导流剩余额度 ${outboundLeft}/${OUTBOUND_DAILY_CAP}`);
  const results = [];
  for (const sel of picks) {
    // 补位选题的素材是站内文章本身；热榜选题的素材是榜单条目
    const refs = sel.kind === 'fill' ? sel.materials : (sel.refs || []).map((i) => fresh[i]).filter(Boolean);
    if (!refs.length) continue;
    // 素材厚度兜底：全部条目都只有标题（微博/抖音/头条无摘要）时，成文只能围着标题打转。
    // 不记 state.done——之后别的榜单带出补充说明时这个话题仍可再选。
    if (sel.kind !== 'fill' && !refs.some((r) => String(r.desc || '').trim().length >= 20)) {
      console.log(`[thin] 「${sel.topic}」素材只有标题（${materialChars(refs)} 字），跳过`);
      continue;
    }
    try {
      // 补位选题固定用「瓜串盘点」体裁——它就是为聚合多条内容设计的
      const style = sel.kind === 'fill'
        ? WRITE_STYLES.find((s) => s.key === 'roundup')
        : pickStyle(sel, state, usedStyles);
      usedStyles.add(style.key);
      // 本篇实际用的体裁设定：素材太少时关掉 FAQ 要求（prompt 与 lintSeo 共用这一份，口径一致）
      const wstyle = style.faq && materialChars(refs) < FAQ_MIN_MATERIAL ? { ...style, faq: false } : style;
      console.log(`[style] 「${sel.topic}」→ ${style.name}(${style.key})${sel.kind === 'fill' ? ' [站内补位]' : ''}`);
      // 补位篇：成员文章优先进内链候选，保证盘点能链回被盘的每一篇
      let linkCands = sel.kind === 'fill'
        ? [...sel.materials.map((m) => ({ title: m.title, path: m.path })),
           ...(await fetchLinkCandidates(sel.channelSlug))]
        : await fetchLinkCandidates(sel.channelSlug);
      // 追更篇：同事件旧文排在内链候选最前，让新文链回旧文——
      // 同一事件的多篇由「互相竞争的同题内容」变成「有主次的话题聚合」。
      if (sel.prevPath) {
        linkCands = [{ title: sel.prevTitle || '此前的报道', path: sel.prevPath },
          ...linkCands.filter((c) => c.path !== sel.prevPath)];
      }
      const basePrompt = writePrompt(prompts, sel, refs, tagLib, wstyle, recentSignals, linkCands);
      let art = await llmJSON(basePrompt, `成文「${sel.topic}」`);
      art.content = stripUnsupportedMarkup(art.content);

      // 套话自检 + SEO 结构自检：违规就带着违规清单重写一次
      const lintAll = (a) => [...lintStyle(a), ...lintSeo(a, wstyle), ...lintFacts(a, sel, refs, linkCands)];
      let violations = lintAll(art);
      if (violations.length) {
        console.warn(`[lint] 「${sel.topic}」命中 ${violations.length} 条套话，重写一次：${violations.join('；')}`);
        try {
          const retry = await llmJSON(
            `${basePrompt}\n\n【重写要求】你上一版违反了以下禁令，必须逐条改掉，其余内容和结构保持不变：\n- ${violations.join('\n- ')}`,
            `重写「${sel.topic}」`,
          );
          retry.content = stripUnsupportedMarkup(retry.content);
          const v2 = lintAll(retry);
          if (v2.length < violations.length) { art = retry; violations = v2; }
        } catch (e) {
          console.warn(`[lint] 重写失败，沿用初稿: ${e.message.slice(0, 80)}`);
        }
      }

      if (art.seo?.metaDescription) {
        const tidied = tidyMetaDescription(art.seo.metaDescription);
        if (tidied !== art.seo.metaDescription) {
          console.log(`[meta] 「${sel.topic}」摘要整理 ${metaDescLen(art)} → ${tidied.length} 字`);
          art.seo = { ...art.seo, metaDescription: tidied };
        }
      }
      if (!metaDescOk(art.seo?.metaDescription)) {
        const before = metaDescLen(art);
        if (await fixMetaDescription(art)) console.log(`[meta] 「${sel.topic}」摘要补写 ${before} → ${metaDescLen(art)} 字`);
        else violations.push(`metaDescription 不达标（${metaDescLen(art)} 字，需 ${META_MIN}~${META_MAX} 且无套话）`);
      }
      // 表格前台渲染不了，重写后仍有就不自动发布，留草稿人工处理
      const markupBlocked = TABLE_RE.test(String(art.content || ''));

      // 标点归一化（中文句内的半角标点）
      art.title = normalizePunct(art.title);
      art.summary = normalizePunct(art.summary);
      art.content = normalizePunct(art.content);

      // 近重复守卫：与近期已发文章高度同题的直接丢弃，不入库（站内重复内容对 SEO 是负分）
      // 追更篇例外——它与旧文同题是设计使然（已在选题阶段验过「有实质新进展」），
      // 不豁免的话阈值降到 0.15 后会把正当的后续报道全部误杀。
      const dup = sel.prevPath ? null : await findNearDuplicate(art.title);
      if (dup) {
        console.warn(`[dup] 「${art.title}」与已发《${dup.title}》相似度 ${dup.score.toFixed(2)}，丢弃不入库`);
        // 这条路径原先无条件落盘，导致 --dry-run 会把选题标记成 done、污染下一次真实运行的去重状态。
        // 与下面的正常入库分支对齐，dry-run 一律不写盘。
        if (!DRY) {
          for (const r of refs) if (r.title) state.done[fingerprint(r.title)] = { t: r.title.slice(0, 30), at: new Date().toISOString(), doc: 'dup-skip' };
          writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
        }
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
      // 追更篇的回链是硬要求（放行它的前提就是「链回旧文形成聚合」），模型没写就补上
      if (sel.prevPath && !art.content.includes(`(${sel.prevPath})`)) {
        art.content += `\n\n## 相关阅读\n\n- [${sel.prevTitle || '此前的报道'}](${sel.prevPath})`;
        console.log(`[link] 「${sel.topic}」追更篇补回链 → ${sel.prevPath}`);
      }

      // 敏感词：CMS 的 article lifecycle（beforeCreate）对「标题+正文」命中即抛错拦截，草稿也存不进去，
      // 所以「命中留草稿」走不通。命中先让模型把这几个词换成中性说法改一次；仍命中就放弃本篇并记 done，
      // 免得下一轮又选中同一话题白跑一遍生成。扫描范围与匹配方式对齐 CMS 的 sensitive-word service。
      let hit = scanSensitive(words, art);
      if (hit.length) {
        console.warn(`[sensitive] 「${sel.topic}」命中敏感词：${hit.join('、')}，改写一次`);
        try {
          const r = await llmJSON(`下面是一篇资讯的标题和正文，其中出现了不允许使用的词：${hit.join('、')}。`
            + `把这些词换成中性的表达，或删去所在短句；其余内容（含 markdown 链接）一字不改。\n\n`
            + `只输出 JSON（content 里的换行转义为 \\n）：{"title":"...","content":"..."}\n\n`
            + JSON.stringify({ title: art.title, content: art.content }), `去敏感词「${sel.topic}」`);
          if (r?.title && r?.content) {
            art.title = normalizePunct(r.title);
            art.content = sanitizeLinks(stripUnsupportedMarkup(normalizePunct(r.content)), linkCands).content;
          }
        } catch (e) {
          if (e.message.startsWith('RATE_LIMIT')) throw e;
          console.warn(`[sensitive] 改写失败: ${e.message.slice(0, 80)}`);
        }
        hit = scanSensitive(words, art);
        if (hit.length) {
          console.warn(`[sensitive] 「${sel.topic}」改写后仍命中（${hit.join('、')}），放弃本篇`);
          if (!DRY) {
            for (const r of refs) if (r.title) state.done[fingerprint(r.title)] = { t: r.title.slice(0, 30), at: new Date().toISOString(), doc: 'sensitive-skip' };
            writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
          }
          continue;
        }
      }
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
      // 截断口径对齐提示词（要的是 3~5 个），原先写死取前 4 个，模型给满 5 个时第 5 个被静默丢掉。
      // 而模型的习惯是泛词在前、具体词在后，被丢的恰好是唯一有价值的那个：
      // 实跑产出过 [网络热议,热搜,大瓜,爆料,医药反腐]、[明星,吃瓜,爆料,娱乐八卦,校园霸凌]，
      // 两次都是第 5 位的具体词被切。结果是「每篇允许新建 1 个标签」这条规则常常轮不到执行，
      // 入库的全是泛词——存量 72 篇「只有泛词没有具体标签」就是这么来的。
      const wanted = (art.tags || []).map((t) => t?.name).filter(Boolean).slice(0, 5);
      // 先复用已存在的
      const reuse = wanted.filter((n) => existingTagSet.has(n));
      const brandNew = wanted.filter((n) => !existingTagSet.has(n));
      for (const name of reuse) {
        const found = await strapi(`/tags?filters[name][$eq]=${encodeURIComponent(name)}&fields[0]=name`);
        if (found.data.length) tagIds.push(found.data[0].documentId);
      }
      // 新建标签只在真实入库时进行：dry-run 照常 POST /tags 但文章从不落库，会留下空标签。
      // （注：存量 395 个空标签里 389 个是 2026-06-19 后台 BulkTags 批量导入的词库，
      //  不是这条路径造成的；这里堵的是一个真实存在但发作概率低的漏子——
      //  wanted 只取前 4 个标签，新词往往排在第 5 位被截掉，所以历史上很少触发。）
      const freshTagIds = [];
      for (const name of brandNew) {
        if (newCount >= MAX_NEW_TAGS) break; // 超额新标签丢弃，抑制孤岛
        if (DRY) { newCount += 1; continue; }
        const src = (art.tags || []).find((t) => t?.name === name);
        const created = await strapi('/tags', { method: 'POST', body: JSON.stringify({ data: { name, slug: String(src?.slug || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-') || undefined } }) });
        tagIds.push(created.data.documentId);
        freshTagIds.push({ id: created.data.documentId, name });
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
        // 兜底：素材一张图都采不到就渲染品牌标题卡（见 gen_cover.py）。
        // 微博源是常态触发者——60s API 的微博端点只返回 title/hot_value/link，
        // 根本没有图片字段，纯微博选题从一开始就无图可采（曾占无封面文章的 90%）。
        // 刻意不去图库抓真人照片：本站写真实人物，来源不明的配图有版权和张冠李戴双重风险。
        if (!coverId) {
          const chName = (CHANNELS_DESC.find(([cs]) => cs === sel.channelSlug)?.[1] || '').split('（')[0];
          coverId = await uploadTitleCard(art.title, slug, chName);
          console.warn(
            coverId
              ? `[cover] 「${sel.topic}」素材无图，已生成品牌标题卡`
              : `[warn] 「${sel.topic}」素材无可用封面图，标题卡也生成失败`,
          );
        }

        // 正文配图（p045：每 500~800 字一张）：把没用作封面的素材图均匀插进正文，最多 MAX_INLINE_IMAGES 张。
        // 素材没有多余图片就跳过——不硬凑，宁可少一张也不放无关图；纯文本素材照常发。
        const MAX_INLINE_IMAGES = 3;
        const blocks = art.content.split('\n').filter((l) => l.trim());
        // 每张图至少隔 2 段，短文少放，免得几张图挤成一串
        const cap = Math.min(MAX_INLINE_IMAGES, Math.max(1, Math.floor((blocks.length - 2) / 2)));
        // alt 用图片所属热榜条目的标题（描述的是这张图本身），不再统一填文章标题——那会和封面 alt 重复
        const spare = [];
        for (const r of refs) {
          if (r.cover && r.cover !== coverSrc && !spare.some((x) => x.src === r.cover)) spare.push({ src: r.cover, alt: r.title || art.title });
        }
        const imgs = [];
        for (const s of spare) {
          if (imgs.length >= cap) break;
          const media = await uploadMedia(s.src, `${slug}-inline-${imgs.length + 1}`);
          if (media?.url) imgs.push({ ...media, alt: s.alt });
        }
        if (imgs.length) {
          // 尺寸写进 markdown 图片 title（"宽x高"），前台据此输出 width/height 预留位置，避免懒加载时版面跳动
          const md = (m) => `![${String(m.alt).replace(/[[\]()]/g, '')}](${m.url}${m.width && m.height ? ` "${m.width}x${m.height}"` : ''})`;
          // 第 i 张放在 (i+1)/(n+1) 处，不早于第 2 段；从后往前插，前面的下标不受影响
          const at = imgs.map((_, i) => Math.max(2, Math.floor((blocks.length * (i + 1)) / (imgs.length + 1))));
          for (let i = imgs.length - 1; i >= 0; i--) blocks.splice(at[i], 0, md(imgs[i]));
          art.content = blocks.join('\n\n');
          console.log(`[img] 「${sel.topic}」正文插图 ${imgs.length} 张`);
        }
      }

      // 自动发布仅限「频道映射成功 + 无前台渲染不了的表格」的文章；否则留草稿 pending 人工审
      // （敏感词命中的上面已经改写或放弃，走到这里的都是干净的）
      const publish = AUTO_PUBLISH && !markupBlocked && !!channel;

      // 文末导流外链：只给直接发布的文章、占当天额度。放在配图插入之后，免得多出的段落把配图位置往后推
      if (publish && outboundLeft > 0) {
        art.content = appendOutbound(art.content);
        outboundLeft -= 1;
        console.log(`[outbound] 「${sel.topic}」挂导流 1 句，今日剩余 ${outboundLeft}`);
      }
      const data = {
        title: art.title, slug, summary: (art.summary || '').slice(0, 300), content: art.content,
        cover: coverId ?? undefined,
        channel: channel?.documentId, tags: tagIds,
        authorRef: author?.documentId, author: author?.name,
        source: [...new Set(refs.map((r) => r.source))].join('/'),
        reviewState: publish ? 'approved' : 'pending',
        publishAt: publish ? new Date().toISOString() : undefined,
        reviewNote: [
          markupBlocked ? '⚠️ 正文含 markdown 表格（前台不支持），已转草稿：改成「- 」列表后再发布' : '',
          violations.length ? `📝 套话自检未通过（已重写仍残留）：${violations.join('；')}` : '',
        ].filter(Boolean).join('\n') || undefined,
        seo: art.seo ? { metaTitle: (art.seo.metaTitle || '').slice(0, 70), metaDescription: (art.seo.metaDescription || '').slice(0, 160), keywords: art.seo.keywords } : undefined,
      };

      if (DRY) {
        const body = String(art.content || '').split('\n').map((s) => s.trim()).filter(Boolean);
        console.log(`[dry] ${art.title} → ${sel.channelSlug} 体裁=${style.name} 字数=${String(art.content || '').length} tags=${(art.tags || []).map((t) => t.name).join(',')}${markupBlocked ? ' ⚠️含表格→草稿' : ''}${violations.length ? ` ⚠️套话:${violations.join('、')}` : ' ✓套话自检通过'}`);
        console.log(`      小标题：${(art.outline || []).join(' / ') || '(未输出 outline)'}`);
        console.log(`      开头：${(body.find((s) => !s.startsWith('#')) || '').slice(0, 50)}…`);
        console.log(`      结尾：…${(body[body.length - 1] || '').slice(-50)}`);
        // DRY_DUMP=<目录>：把整篇产出（含 facts 清单与素材）落盘，便于人工比对改 prompt 前后的效果
        if (process.env.DRY_DUMP) {
          mkdirSync(process.env.DRY_DUMP, { recursive: true });
          writeFileSync(join(process.env.DRY_DUMP, `${slug || 'draft'}.json`),
            JSON.stringify({ style: wstyle.key, length: lengthFor(refs), refs, violations, ...art }, null, 2));
        }
      } else {
        // 标签先于文章创建（POST 文章时要带 documentId），文章这一步失败就会留下孤儿标签，
        // 所以失败时把本篇刚建的新标签删掉再把错抛回去。
        let created;
        try {
          created = await strapi(`/articles${publish ? '?status=published' : ''}`, { method: 'POST', body: JSON.stringify({ data }) });
        } catch (e) {
          for (const t of freshTagIds) {
            try {
              await strapi(`/tags/${t.id}`, { method: 'DELETE' });
              console.warn(`[rollback] 文章入库失败，删除刚建的标签「${t.name}」`);
            } catch { /* 删不掉就留着，由 --clean-tags 兜底 */ }
          }
          throw e;
        }
        console.log(`[save] ${publish ? '已发布' : '草稿'} ✓ ${art.title} /${sel.channelSlug}/${slug} (${created.data.documentId})${markupBlocked ? ' ⚠️含表格→草稿' : ''}`);
        if (sel.kind === 'fill') {
          // 同一标签 FILL_COOLDOWN_DAYS 天内不再盘第二次
          state.fills = [...(state.fills || []), { tag: sel.tag, at: new Date().toISOString() }].slice(-60);
        } else {
          for (const r of refs) state.done[fingerprint(r.title)] = { t: r.title.slice(0, 30), at: new Date().toISOString(), doc: created.data.documentId };
          // 事件登记：下一轮选题时作为「已写事件」注入，并让模型原样复用同一个 eventKey。
          // 记的是 sel.eventKey（选题阶段的稳定标识）而不是成文标题——标题每篇都被要求写得不一样。
          const ek = eventKeyOf(sel.eventKey || sel.topic);
          if (ek) {
            state.events = state.events || {};
            state.events[ek] = { title: art.title, path: `/${sel.channelSlug}/${slug}`, at: new Date().toISOString(), doc: created.data.documentId };
          }
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
  console.log(`[done] 生成 ${results.length}/${picks.length} 篇${DRY ? '（dry-run 未入库）' : AUTO_PUBLISH ? '（自动发布开启，含表格者留草稿）' : '，已入草稿箱等待审核（reviewState=pending）'}`);
}

// 用 exitCode 而不是 process.exit()，保证 finally 里的解锁一定执行
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { releaseLock(); process.exit(130); });

main()
  .catch((e) => { console.error(`[fatal] ${e.message}`); process.exitCode = 1; })
  .finally(releaseLock);
