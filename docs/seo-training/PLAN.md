# 阶段 4 · 改造提案（仅方案，未执行）

> 依据 `GAP.md`。**在明确回复"执行"前不修改任何生产文件。**
> 涉及 2 个生产文件 + 1 处生产数据：
> - `apps/web/app/[channelSlug]/[articleSlug]/page.tsx`（前台正文渲染）
> - `scripts/hot-sync/index.mjs`（生成管线）
> - Strapi「热榜二创配置」`writePrompt`（用 `--upgrade-prompt` 同步，非文件）

## 改造项总览

| # | 改造项 | 文件 | 对应 GAP | 阻塞关系 |
|---|---|---|---|---|
| 1 | 前台正文 markdown 渲染器 | page.tsx | 勘误 P0 | **阻塞 2、7、8** |
| 2 | 正文内链 2~3 条（含候选集注入 + 防编造校验 + 兜底） | index.mjs | 需新增 P0 | 依赖 1 |
| 3 | metaDescription 补下限 120 | index.mjs | 需新增 P0 | 无 |
| 4 | FAQ 模块 | index.mjs | 需新增 P1 | 无 ⚠️有权衡待决 |
| 5 | 小标题强制 ≥2 | index.mjs | 需新增 P1 | 依赖 1 |
| 6 | 概述段含核心关键词 | index.mjs | 需新增 P1 | 无 |
| 7 | 正文配图（复用素材图） | index.mjs | 需新增 P2 | 依赖 1 |
| 8 | 字数区间上调 900~1500 | index.mjs | 需修改 | 依赖 4 |
| 9 | keywords 3~5、标签 3~5 | index.mjs | 需修改 | 无 |
| 10 | `lintSeo()` 结构质量门 | index.mjs | 需新增 P3 | 依赖 2/5 |

---

## 改造项 1（P0·前置）前台正文 markdown 渲染器

**文件**：`apps/web/app/[channelSlug]/[articleSlug]/page.tsx` 第 143~157 行

**问题**：当前把每一行无差别包成 `<p>`，并主动剥掉行首 `#`，导致小标题/链接/配图/加粗全部失效。

**方案 A（推荐·零依赖）**：手写受限渲染器，只支持我们自己生成的 markdown 子集（`##`/`###`、`[]()`、`![]()`、`**`、`- ` 列表），**先 HTML 转义再按白名单还原**，无 XSS 面，服务端渲染不依赖客户端 JS（符合 §4 MUST）。

**方案 B**：引入 `react-markdown` + `remark-gfm` + `rehype-sanitize`。功能全，但新增 3 个依赖、需配 sanitize 白名单。

以下 diff 按方案 A：

```diff
--- a/apps/web/app/[channelSlug]/[articleSlug]/page.tsx
+++ b/apps/web/app/[channelSlug]/[articleSlug]/page.tsx
@@ -143,17 +143,10 @@
       {/* 正文：服务端完整输出（§4 MUST：不得依赖客户端 JS） */}
       <div className="article-body mt-4">
         {(() => {
-          const paras = (article.content ?? article.summary ?? '')
-            .split('\n')
-            .filter((line) => line.trim().length > 0)
-            .map((line) => line.replace(/^#+\s*/, ''));
-          // 正文内原生位：约第 3 段后插入（正文 ≥5 段才插，避免短文打断阅读）
-          const adAfter = paras.length >= 5 ? 2 : -1;
-          return paras.map((line, i) => [
-            <p key={`p-${i}`}>{line}</p>,
-            i === adAfter ? <AdSlotBanner key="article-inline" slotKey="article-inline" /> : null,
-          ]);
+          const blocks = renderArticleMarkdown(article.content ?? article.summary ?? '');
+          // 正文内原生位：约第 3 块后插入（正文 ≥5 块才插，避免短文打断阅读）
+          const adAfter = blocks.length >= 5 ? 2 : -1;
+          return blocks.map((node, i) => [
+            node,
+            i === adAfter ? <AdSlotBanner key="article-inline" slotKey="article-inline" /> : null,
+          ]);
         })()}
       </div>
```

新增 `apps/web/lib/markdown.tsx`（约 70 行，节选核心）：

```tsx
/**
 * 受限 markdown 渲染（仅支持管线会产出的语法子集）。
 * 安全模型：不使用 dangerouslySetInnerHTML，全部走 React 元素，天然转义。
 * 支持：## / ### 标题、- 列表、[文本](/站内路径)、![alt](图片)、**加粗**
 * 站外链接自动加 rel="nofollow noopener"（对齐 p045 R045-07）
 */
export function renderArticleMarkdown(md: string): JSX.Element[] { … }

// 行内解析：**加粗** 与 [文本](url)，其余原样输出为文本节点
function inline(text: string, key: string): React.ReactNode[] { … }
```

**渲染映射**：
| markdown | 输出 | 依据 |
|---|---|---|
| `## X` | `<h2>` | p045 R045-08/09 H 层级 |
| `### X` | `<h3>` | 同上 |
| `- X` | `<ul><li>` | p111/p108 列表结构 |
| `[文本](/a/b)` | `<a href>`（站内） | p045 R045-06 内链 |
| `[文本](https://…)` | `<a rel="nofollow noopener">` | p045 R045-07 |
| `![alt](url)` | `<img alt loading="lazy">` | p045 R045-12 alt |
| `**词**` | `<strong>` | p111 R111-06 关键词加粗 |

**回归风险**：252 篇存量文章会被重新解析。存量正文里 63% 含 `## `——渲染后它们会**从段落变成 h2**，这是修复不是破坏；但需检查是否有正文以 `- ` 开头的行被误判为列表（阶段 5 验证项）。

---

## 改造项 2（P0）正文内链 2~3 条

**文件**：`scripts/hot-sync/index.mjs`

**难点**：模型不知道站内有哪些文章，直接要求加链接必然**编造 URL**。方案是"候选集注入 + 白名单校验 + 兜底追加"三层。

```diff
+// ---------- 内链候选集 ----------
+// 模型不可能知道站内有什么文章，必须把候选清单喂给它；
+// 且生成后要校验链接必须落在候选集内，杜绝编造 URL（404 内链比没有内链更糟）。
+async function fetchLinkCandidates(channelSlug, n = 24) {
+  try {
+    const q = `/articles?sort=publishAt:desc&pagination[pageSize]=${n}`
+      + `&fields[0]=title&fields[1]=slug&populate[channel][fields][0]=slug`
+      + (channelSlug ? `&filters[channel][slug][$eq]=${encodeURIComponent(channelSlug)}` : '');
+    const res = await strapi(q);
+    return (res.data || [])
+      .filter((a) => a.slug && a.channel?.slug)
+      .map((a) => ({ title: a.title, path: `/${a.channel.slug}/${a.slug}` }));
+  } catch (e) {
+    console.warn(`[warn] 内链候选拉取失败: ${e.message.slice(0, 80)}`);
+    return [];
+  }
+}
```

提示词（`DEFAULT_WRITE_PROMPT` 的【约束】段）新增：

```diff
 - 语气像朋友聊天，但不低俗、不油腻；移动端短段落，每段不超过 4 行
+- 正文中必须自然嵌入 2~3 条站内链接，格式 `[锚文本](路径)`：
+  · 路径**只能**从下面「可链接文章」清单里原样复制，一个字符都不能改，更不许自己编造路径
+  · 锚文本要是句子里的自然短语（如「此前那起校园争议」），禁止「点击这里」「查看详情」这类空锚文本
+  · 链接要放在正文语义相关处，不要堆在结尾
+  可链接文章（路径必须原样复制）：
+{{links}}
```

生成后校验 + 兜底（在 `lintSeo` 与入库之间）：

```diff
+      // 内链校验：剔除不在候选集内的编造链接；不足 2 条时用「相关阅读」兜底
+      const allowed = new Map(linkCandidates.map((c) => [c.path, c.title]));
+      art.content = String(art.content).replace(/\[([^\]]+)\]\((\/[^)]+)\)/g, (m, txt, path) =>
+        allowed.has(path) ? m : txt);            // 编造的链接降级为纯文本，不留 404
+      const linkCount = [...String(art.content).matchAll(/\]\((\/[^)]+)\)/g)].length;
+      if (linkCount < 2 && linkCandidates.length >= 2) {
+        const picks = linkCandidates.filter((c) => !art.content.includes(c.path)).slice(0, 2);
+        art.content += `\n\n## 相关阅读\n\n` + picks.map((p) => `- [${p.title}](${p.path})`).join('\n');
+        console.log(`[link] 「${sel.topic}」内链不足(${linkCount})，已兜底追加 ${picks.length} 条`);
+      }
```

**为什么必须校验**：编造的站内链接会产生 404 内链，比零内链更伤——这一点 5 篇培训都没提到，是我们自己的工程约束 `[非原文]`。

---

## 改造项 3（P0）metaDescription 补下限

```diff
-- seo.metaTitle ≤60 字符；seo.metaDescription ≤150 字符；seo.keywords 逗号分隔 3~6 个中文词
+- seo.metaTitle ≤60 字符
+- seo.metaDescription **120~160 字符**（少于 120 字视为不合格；这是搜索结果里的摘要位，写满）
+- seo.keywords 逗号分隔 3~5 个中文词
```

依据 p045「Description 120~160 字符，自然融入关键词」。当前均值 58 字，100% 不达标，根因就是只写了上限。

---

## 改造项 4（P1）FAQ 模块 ⚠️ 有权衡，需你决定

依据 p111「FAQ 必做，5 个问题，每个回答 2–3 行」+ p108「事件类/资讯类必备，扩展长尾语义」。

**冲突点**：我们刚花一整轮把"每篇都长一个样"改掉。**若 10 个体裁全部强制 FAQ，等于给所有文章重新装上同一个尾巴，模板痕迹会回潮。**

给三个选项：

| 选项 | 做法 | 代价 |
|---|---|---|
| **4-A（推荐）** | 只对 5 个"事件解析类"体裁强制：timeline / factcheck / insider / reaction / deepdig；scene / roundup / debate / dossier 不加；qna 本身即问答不重复加 | 覆盖率约 50%，长尾覆盖不如全量 |
| 4-B | 全部体裁强制，但问题数 3~5 随机、小标题措辞按体裁变化（「几个还在问的问题」「读者最关心的」…） | 覆盖率 100%，模板痕迹风险中等 |
| 4-C | 不做 | 放弃 p111「必做」与 p108 长尾扩展 |

4-A 的 diff（在 `WRITE_STYLES` 每个体裁加 `faq: true/false`，并在提示词条件注入）：

```diff
   {
     key: 'timeline', name: '时间线扒瓜', channels: '*',
+    faq: true,
     role: '你是擅长把一团乱麻的瓜按时间轴捋顺的资讯编辑…',
```

```diff
+{{faqBlock}}
```
`faqBlock` 渲染为：
```
- 正文末尾加一个 FAQ 小节（3~5 问）：问题必须是读者真的会搜的具体问题，从素材里能答出来的才写，答不了的写「目前没有公开信息」；
  每问 2~3 行；小节标题不要每篇都叫「FAQ」，按本篇体裁换措辞
```

---

## 改造项 5、6（P1）小标题强制 + 概述段关键词

```diff
 【格式】
-先在 outline 字段里按上面的结构列出本篇的小标题草案（3~5 条），再照着它写 content——先列后写，不要边想边写。
+先在 outline 字段里按上面的结构列出本篇的小标题草案（3~5 条），再照着它写 content——先列后写，不要边想边写。
+outline 里的每一条都必须以 `## ` 开头的小标题形式真实出现在 content 里（至少 2 个），不能只列不写。
+首段必须自然出现 seo.keywords 的第一个关键词（p111：概述段核心关键词必须出现），但不要为塞词而生硬。
```

---

## 改造项 7（P2）正文配图

素材 `refs` 每条自带 `cover`，目前只取第一张做封面，其余丢弃。

```diff
+      // 正文配图：把未用作封面的素材图插到正文中部（p045：每 500~800 字一图）
+      const spare = refs.map((r) => r.cover).filter(Boolean).filter((u) => u !== usedCoverUrl);
+      if (spare.length && !DRY) {
+        const mid = Math.floor(paras.length / 2);
+        paras.splice(mid, 0, `![${art.title}](${await uploadInline(spare[0], slug)})`);
+        art.content = paras.join('\n\n');
+      }
```
**依赖改造项 1**（否则 `![]()` 原样显示为文本）。素材无图时跳过，不硬凑。

---

## 改造项 8、9（需修改）字数与数量口径

```diff
-用下面的素材写一篇原创短资讯，体裁为「{{styleName}}」，正文 700~1200 字。
+用下面的素材写一篇原创短资讯，体裁为「{{styleName}}」，正文 900~1500 字。
```
理由：加了 FAQ（3~5 问 × 2~3 行）+ 内链 + 小标题后，700 字下限装不下培训要求的模块量。

```diff
-- tags：2~4 个，name 中文、slug 英文小写连字符。
+- tags：3~5 个，name 中文、slug 英文小写连字符。
```
对齐 p108「每篇保留 3~5 个标签」。**防孤岛硬约束（每篇最多新建 1 个标签）保持不变**，因此实际仍以复用为主。

---

## 改造项 10（P3）`lintSeo()` 结构质量门

现有 `lintStyle()` 只查套话。新增 SEO 结构检查，与套话检查并入同一重写循环：

```diff
+// SEO 结构自检（对齐 p045 发布后检查清单 + p108 修复后检查标准）
+function lintSeo(art, style) {
+  const v = [];
+  const c = String(art.content || '');
+  const headings = (c.match(/^## /gm) || []).length;
+  if (headings < 2) v.push(`小标题不足（${headings} 个，需 ≥2）`);
+  const links = [...c.matchAll(/\]\((\/[^)]+)\)/g)].length;
+  if (links < 2) v.push(`站内链接不足（${links} 条，需 2~3）`);
+  const d = String(art.seo?.metaDescription || '');
+  if (d.length < 120) v.push(`metaDescription 过短（${d.length} 字，需 120~160）`);
+  const kw = String(art.seo?.keywords || '').split(/[,，]/).filter(Boolean).length;
+  if (kw < 3 || kw > 5) v.push(`keywords 数量 ${kw}（需 3~5）`);
+  if (style.faq && !/^## .*(问|FAQ|答)/m.test(c)) v.push('缺 FAQ 小节');
+  return v;
+}
```

**处置策略**（两级，需你确认取哪级）：
- **宽松（推荐）**：不合格 → 重写 1 次 → 仍不合格则**照常发布**但写入 `reviewNote`
- 严格：不合格 → 重写 1 次 → 仍不合格则 `reviewState='pending'` 不自动发布，等人工

严格档会降低日产量（现约 50 篇/天），宽松档保证产量但允许瑕疵上线。

---

## 不采纳项（重申，来自 GAP 第四节）

伪热点自造标题、擦边关键词库、换壳法批量、"完整版视频在哪看"式 FAQ、网传聊天记录汇总模块、无来源的人物过往黑料、虚构审校人署名、关键词密度 2%~3%、标签人名优先——共 9 条，理由见 `GAP.md` 4.1。

---

## 执行顺序建议

```
第 1 步  改造项 1（前台渲染器）→ 构建 → pm2 restart → 存量文章回归检查
第 2 步  改造项 3、6、8、9（纯提示词，低风险）
第 3 步  改造项 2、5、10（内链 + 质量门，需 dry-run 验证）
第 4 步  改造项 4（FAQ，按你选的 A/B/C）
第 5 步  改造项 7（正文配图）
第 6 步  --upgrade-prompt 同步后台，阶段 5 并排对比验证
```

## 需要你拍板的 3 件事

1. **改造项 1**：方案 A（手写零依赖渲染器）还是方案 B（react-markdown + sanitize）？
2. **改造项 4**：FAQ 覆盖范围选 4-A（5 个体裁）/ 4-B（全量）/ 4-C（不做）？
3. **改造项 10**：质量门用宽松档还是严格档？
