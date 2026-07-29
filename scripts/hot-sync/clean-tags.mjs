#!/usr/bin/env node
/**
 * 标签治理脚本（scripts/hot-sync/clean-tags.mjs）
 *
 * 2026-07-29 体检结果：521 个标签里 395 个（76%）零文章、73 个（14%）只有 1 篇，
 * 真正撑得起聚合页的只有 53 个。三个成因分别对应下面三步：
 *   ① 空标签   ← 395 个里 389 个是 2026-06-19 13:09~13:10 两分钟内建的，
 *                即后台 BulkTags 批量导入的一批词库，导进去之后从没被用过（不是管线产生的）
 *   ② 近义分裂 ← 热搜/网络热搜/抖音热点、网络热议/网友热议、明星/明星动态 各自为政
 *   ③ 实体漏标 ← 站内 7 篇写周星驰，却只有 1 篇挂了「周星驰」标签，聚合页形同虚设
 *
 * 空标签在前台是 404、也不进 sitemap（getAllTagSlugs 已过滤），所以①纯属后台噪音；
 * 真正伤 SEO 的是②③——sitemap 里 126 个标签页有 73 个只挂着 1 篇，属于薄内容。
 *
 * 写入只经 Strapi REST（PUT ?status=published 会同时更新草稿与已发布两行）。
 *
 * 用法：
 *   node clean-tags.mjs                      # 只报告，不写任何东西（默认）
 *   node clean-tags.mjs --apply              # 执行：删空标签 + 合并近义 + 回填实体标签
 *   node clean-tags.mjs --apply --drop-oneoff  # 额外删掉「不会再复现」的一次性标签
 */
import { readFileSync, existsSync } from 'node:fs';
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
const URL_BASE = process.env.STRAPI_API_URL || 'http://127.0.0.1:1337';
const TOKEN = process.env.STRAPI_API_TOKEN;
if (!TOKEN) throw new Error('.env 缺 STRAPI_API_TOKEN');

const APPLY = process.argv.includes('--apply');
const DROP_ONEOFF = process.argv.includes('--drop-oneoff');
const BACKFILL_ALL = process.argv.includes('--backfill-all');

async function api(path, opts = {}) {
  const res = await fetch(`${URL_BASE}/api${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${path} ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? null : res.json();
}

// ---------- 全量回填（--backfill-all）----------
// ENTITY/THEME 是手写清单，覆盖不到的标签还有很多。这里加一条通用规则：
// 中文标签绝大多数是「字面词」，标题里出现该词基本就是该标签的文章，
// 所以直接拿标签名当关键词扫一遍，成本极低、覆盖面最大。
//
// 两条护栏：
// ① 只回填「覆盖不足」的标签（文章数 < BACKFILL_CEIL）。已经几十上百篇的大标签
//    不缺文章，再灌只会变成什么都装的万能标签，聚合页反而失去区分度。
// ② 过泛的词不参与：它们在标题里的出现多半不是「这篇属于该分类」的意思
//    （「上热搜」「大瓜」几乎每篇都能沾边），扫出来的是噪音不是覆盖。
const BACKFILL_CEIL = 20;
const TOO_GENERIC = new Set(['热搜', '网络热议', '吃瓜', '围观', '出圈', '反转', '大瓜', '黑料',
  '实锤', '爆料', '视频', '微博热搜', '热榜', '娱乐八卦', '明星', '冲突', '塌房', '顶流', '赛后']);

// ---------- 近义合并表（from → to）----------
// 只收「同义或包含关系、合并后聚合页语义不变」的；拿不准的一律不动，留给人工。
const MERGE = {
  网络热搜: '热搜',
  抖音热点: '热搜',
  热榜: '热搜',
  网友热议: '网络热议',
  社会热点: '网络热议',
  明星动态: '明星',
  娱乐圈瓜: '娱乐八卦',
  娱乐资讯: '娱乐八卦',
  楚超联赛: '乒超联赛',   // 模型笔误，站内只有乒超
  世界女排联赛: '排球',
  中国女排: '排球',
  高考志愿: '高考',
  北大校友: '北大数院',
  华人数学家: '菲尔兹奖',
  隐私争议: '隐私权',
  动物趣闻: '动物',
  网红维权: '维权',
  车主维权: '维权',
};

// ---------- 实体标签回填 ----------
// 这些标签指向会反复出现的实体，站内往往已有多篇同实体文章却没挂上标签。
// 按标题关键词回填，把 1 篇的死标签变成真正的聚合页。只匹配标题，不碰正文——正文提一嘴不代表是主角。
const ENTITY = [
  { tag: '周星驰', match: ['周星驰'] },
  { tag: '王楚钦', match: ['王楚钦'] },
  { tag: '菲尔兹奖', match: ['菲尔兹'] },
  { tag: '王虹', match: ['王虹'] },
  { tag: '张柏芝', match: ['张柏芝'] },
  { tag: '谢霆锋', match: ['谢霆锋'] },
  { tag: '毛大庆', match: ['毛大庆'] },
  { tag: '腾讯', match: ['腾讯'] },
  { tag: '王菲', match: ['王菲'] },
  { tag: '刘德华', match: ['刘德华'] },
  { tag: '鹿晗', match: ['鹿晗'] },
  { tag: '李小冉', match: ['李小冉'] },
  { tag: '张凌赫', match: ['张凌赫'] },
  { tag: '王楚然', match: ['王楚然'] },
  { tag: '向太', match: ['向太'] },
  { tag: '贫困生', match: ['贫困生'] },
  { tag: '乒超联赛', match: ['乒超'] },
];

// ---------- 泛主题标签回填 ----------
// 体检发现：孤岛标签里最大的一类根本不缺内容，缺的是标签本身——
// 「职场」站内 13 篇相关只挂了 1 篇、「健康」12 篇挂 0 篇、「社会案件」11 篇挂 0 篇。
// 所以这类标签正确的填法是回填站内已有文章，不是去外站抓内容再写一篇同质的。
// 关键词刻意取窄（宁可少挂也不错挂）：像「公司」「病」这种宽词会把无关文章卷进来，
// 一律不收。--apply 前先看报告里列出的命中标题，确认没跑偏。
const THEME = [
  { tag: '职场', match: ['职场', '打工', '员工', '裁员', '加班', '年终奖', '离职', '辞退'] },
  { tag: '大厂', match: ['大厂', '腾讯', '阿里', '字节', '华为'] },
  { tag: '健康', match: ['医院', '医生', '手术', '结肠癌', '脑溢血', '卫健'] },
  { tag: '投资', match: ['股价', '基金', '理财', '巨亏', 'ETF', '市值', '蒸发'] },
  { tag: '追星', match: ['追星', '粉丝', '应援', '接机'] },
  { tag: '社会案件', match: ['法院', '警方', '判', '起诉', '拘捕', '受贿', '诈骗'] },
  { tag: '电影票房', match: ['票房', '点映', '撤档', '开画'] },
  { tag: '暑期档', match: ['暑期档'] },
  { tag: '育儿观', match: ['育儿', '萌娃', '家长', '孩子'] },
  { tag: '综艺', match: ['综艺', '真人秀'] },
  { tag: '职业教育', match: ['中职', '职校', '职业教育'] },
  { tag: '反垄断', match: ['垄断', '被罚'] },
  { tag: '英雄联盟', match: ['英雄联盟', '电竞', 'LPL'] },
  { tag: '催婚', match: ['催婚', '相亲'] },
];

// ---------- 一次性标签（--drop-oneoff 才删）----------
// 判据：指向一个不会复现的具体细节，留着也永远只有 1 篇。
const ONEOFF = ['视频', '导演梦', '水军产业链', '共享充电宝', '远程锁车', '黑八奇迹', '赛马机制',
  '龙凤胎', '表情包', '删博', '吃菌子', '警察出警', '昆明趣闻', '暖心瞬间', '治安处罚',
  '复读', '厦门大学', 'AI换脸', 'AI短剧', '催婚', '助农', '交通违法', '正当防卫'];

const MIN_TAGS_AFTER = 2; // 摘掉标签后文章至少还要剩几个，不够就不摘

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

async function main() {
  console.log(`[clean-tags] ${APPLY ? '执行模式' : '报告模式（不写入，加 --apply 才执行）'}\n`);

  const tags = (await allPages('/tags?fields[0]=name&fields[1]=slug&populate[articles][count]=true'))
    .map((t) => ({ name: t.name, slug: t.slug, doc: t.documentId, n: t.articles?.count ?? 0 }));
  const byName = new Map(tags.map((t) => [t.name, t]));
  console.log(`标签总数 ${tags.length}：零文章 ${tags.filter((t) => t.n === 0).length}，1 篇 ${tags.filter((t) => t.n === 1).length}，≥2 篇 ${tags.filter((t) => t.n >= 2).length}\n`);

  // ---------- 1. 删空标签 ----------
  const empty = tags.filter((t) => t.n === 0);
  console.log(`【1】零文章标签 ${empty.length} 个 → 删除`);
  console.log(`     ${empty.slice(0, 20).map((t) => t.name).join('、')}${empty.length > 20 ? ` …等 ${empty.length} 个` : ''}`);
  if (APPLY) {
    let ok = 0;
    for (const t of empty) {
      try { await api(`/tags/${t.doc}`, { method: 'DELETE' }); ok += 1; } catch (e) { console.warn(`     [warn] 删除「${t.name}」失败: ${e.message.slice(0, 60)}`); }
    }
    console.log(`     ✓ 已删除 ${ok}/${empty.length}`);
  }

  // ---------- 2. 合并近义标签 ----------
  console.log(`\n【2】近义标签合并`);
  for (const [from, to] of Object.entries(MERGE)) {
    const f = byName.get(from); const t = byName.get(to);
    if (!f) continue;
    if (!t) { console.warn(`     [skip] 「${from}」→「${to}」：目标标签不存在`); continue; }
    const arts = await allPages(`/articles?status=published&filters[tags][name][$eq]=${encodeURIComponent(from)}&populate[tags][fields][0]=name`);
    console.log(`     「${from}」(${f.n}篇) → 「${to}」(${t.n}篇)，需改 ${arts.length} 篇`);
    if (!APPLY) continue;
    for (const a of arts) {
      const keep = (a.tags || []).filter((x) => x.name !== from).map((x) => x.documentId);
      if (!keep.includes(t.doc)) keep.push(t.doc);
      try {
        await api(`/articles/${a.documentId}?status=published`, { method: 'PUT', body: JSON.stringify({ data: { tags: keep } }) });
      } catch (e) { console.warn(`     [warn] 改《${a.title}》失败: ${e.message.slice(0, 60)}`); }
    }
    try { await api(`/tags/${f.doc}`, { method: 'DELETE' }); console.log(`     ✓ 已合并并删除「${from}」`); } catch (e) { console.warn(`     [warn] 删除「${from}」失败: ${e.message.slice(0, 60)}`); }
  }

  // ---------- 3. 实体标签回填 ----------
  console.log(`\n【3】实体标签回填（把只挂 1 篇的实体标签补到同实体的其他文章上）`);
  for (const ent of ENTITY) {
    const t = byName.get(ent.tag);
    if (!t) { console.warn(`     [skip] 标签「${ent.tag}」不存在`); continue; }
    const hits = [];
    for (const kw of ent.match) {
      const arts = await allPages(`/articles?status=published&filters[title][$contains]=${encodeURIComponent(kw)}&populate[tags][fields][0]=name`);
      for (const a of arts) if (!hits.some((h) => h.documentId === a.documentId)) hits.push(a);
    }
    const missing = hits.filter((a) => !(a.tags || []).some((x) => x.name === ent.tag));
    if (!missing.length) { console.log(`     「${ent.tag}」：${hits.length} 篇同实体文章，已全部挂标签 ✓`); continue; }
    console.log(`     「${ent.tag}」：站内 ${hits.length} 篇，其中 ${missing.length} 篇没挂标签 → 回填`);
    if (!APPLY) continue;
    for (const a of missing) {
      // 每篇最多 5 个标签，满了就不硬塞
      const cur = (a.tags || []).map((x) => x.documentId);
      if (cur.length >= 5) continue;
      try {
        await api(`/articles/${a.documentId}?status=published`, { method: 'PUT', body: JSON.stringify({ data: { tags: [...cur, t.doc] } }) });
      } catch (e) { console.warn(`     [warn] 《${a.title}》回填失败: ${e.message.slice(0, 60)}`); }
    }
    console.log(`     ✓ 「${ent.tag}」回填 ${missing.length} 篇`);
  }

  // ---------- 3b. 泛主题标签回填 ----------
  console.log(`\n【3b】泛主题标签回填（这类孤岛不缺内容，缺的是标签）`);
  for (const th of THEME) {
    const t = byName.get(th.tag);
    if (!t) { console.warn(`     [skip] 标签「${th.tag}」不存在`); continue; }
    const hits = [];
    for (const kw of th.match) {
      const arts = await allPages(`/articles?status=published&filters[title][$contains]=${encodeURIComponent(kw)}&populate[tags][fields][0]=name`);
      for (const a of arts) if (!hits.some((h) => h.documentId === a.documentId)) hits.push(a);
    }
    // 标签位有限（每篇最多 5 个），满了的不硬塞
    const missing = hits.filter((a) => !(a.tags || []).some((x) => x.name === th.tag) && (a.tags || []).length < 5);
    if (!missing.length) { console.log(`     「${th.tag}」：${hits.length} 篇相关，无需回填 ✓`); continue; }
    console.log(`     「${th.tag}」：站内 ${hits.length} 篇相关，${missing.length} 篇待回填`);
    if (!APPLY) {
      // 报告模式把命中标题列出来，好人工判断关键词有没有跑偏
      missing.slice(0, 5).forEach((a) => console.log(`         · ${a.title}`));
      if (missing.length > 5) console.log(`         · …另 ${missing.length - 5} 篇`);
      continue;
    }
    let ok = 0;
    for (const a of missing) {
      const cur = (a.tags || []).map((x) => x.documentId);
      try {
        await api(`/articles/${a.documentId}?status=published`, { method: 'PUT', body: JSON.stringify({ data: { tags: [...cur, t.doc] } }) });
        ok += 1;
      } catch (e) { console.warn(`     [warn] 《${a.title}》回填失败: ${e.message.slice(0, 60)}`); }
    }
    console.log(`     ✓ 「${th.tag}」回填 ${ok} 篇`);
  }

  // ---------- 3c. 全量回填 ----------
  if (BACKFILL_ALL) {
    console.log(`\n【3c】全量回填（标签名当关键词，只补文章数 < ${BACKFILL_CEIL} 的标签）`);
    const thin = tags.filter((t) => t.n > 0 && t.n < BACKFILL_CEIL && !TOO_GENERIC.has(t.name)
      && !ENTITY.some((e) => e.tag === t.name) && !THEME.some((e) => e.tag === t.name));
    console.log(`     待扫标签 ${thin.length} 个（已排除过泛词 ${TOO_GENERIC.size} 个、手写清单已覆盖的）`);
    let total = 0;
    for (const t of thin) {
      // 标签名太短的不扫：1~2 字的词在标题里撞车概率高（「瓜」「车」这类）
      if (t.name.length < 2) continue;
      let arts;
      try {
        arts = await allPages(`/articles?status=published&filters[title][$contains]=${encodeURIComponent(t.name)}&populate[tags][fields][0]=name`);
      } catch (e) { console.warn(`     [warn] 扫「${t.name}」失败: ${e.message.slice(0, 50)}`); continue; }
      const missing = arts.filter((a) => !(a.tags || []).some((x) => x.name === t.name) && (a.tags || []).length < 5);
      if (!missing.length) continue;
      console.log(`     「${t.name}」(${t.n}篇) → 命中 ${arts.length} 篇，回填 ${missing.length} 篇`);
      if (!APPLY) { missing.slice(0, 3).forEach((a) => console.log(`         · ${a.title}`)); total += missing.length; continue; }
      for (const a of missing) {
        const cur = (a.tags || []).map((x) => x.documentId);
        try {
          await api(`/articles/${a.documentId}?status=published`, { method: 'PUT', body: JSON.stringify({ data: { tags: [...cur, t.doc] } }) });
          total += 1;
        } catch (e) { console.warn(`     [warn] 《${a.title}》失败: ${e.message.slice(0, 50)}`); }
      }
    }
    console.log(`     ${APPLY ? '✓ 共回填' : '待回填'} ${total} 篇`);
  }

  // ---------- 4. 一次性标签 ----------
  console.log(`\n【4】一次性孤岛标签 ${ONEOFF.length} 个${DROP_ONEOFF ? ' → 删除' : '（加 --drop-oneoff 才删）'}`);
  const present = ONEOFF.filter((n) => byName.has(n));
  console.log(`     站内实际存在 ${present.length} 个：${present.join('、')}`);
  if (APPLY && DROP_ONEOFF) {
    for (const name of present) {
      const t = byName.get(name);
      const arts = await allPages(`/articles?status=published&filters[tags][name][$eq]=${encodeURIComponent(name)}&populate[tags][fields][0]=name`);
      // 安全阀：摘掉后文章标签数不能低于 MIN_TAGS_AFTER，否则宁可留着这个标签
      const unsafe = arts.find((a) => (a.tags || []).length - 1 < MIN_TAGS_AFTER);
      if (unsafe) { console.warn(`     [skip] 「${name}」：《${unsafe.title}》摘掉后只剩 ${(unsafe.tags || []).length - 1} 个标签`); continue; }
      for (const a of arts) {
        const keep = (a.tags || []).filter((x) => x.name !== name).map((x) => x.documentId);
        try { await api(`/articles/${a.documentId}?status=published`, { method: 'PUT', body: JSON.stringify({ data: { tags: keep } }) }); } catch (e) { console.warn(`     [warn] ${e.message.slice(0, 60)}`); }
      }
      try { await api(`/tags/${t.doc}`, { method: 'DELETE' }); console.log(`     ✓ 已删除「${name}」`); } catch (e) { console.warn(`     [warn] 删除「${name}」失败: ${e.message.slice(0, 60)}`); }
    }
  }

  // ---------- 汇总 ----------
  if (APPLY) {
    const after = (await allPages('/tags?fields[0]=name&populate[articles][count]=true')).map((t) => t.articles?.count ?? 0);
    console.log(`\n[done] 治理后标签 ${after.length} 个：零文章 ${after.filter((n) => n === 0).length}，1 篇 ${after.filter((n) => n === 1).length}，≥2 篇 ${after.filter((n) => n >= 2).length}`);
  } else {
    console.log(`\n[done] 报告完毕，未写入任何数据。确认无误后加 --apply 执行。`);
  }
}

main().catch((e) => { console.error(`[fatal] ${e.message}`); process.exitCode = 1; });
