// Pure text helpers shared by the scripts/* pipelines. No I/O, no pipeline-specific vocabulary.

// {{name}} 占位符渲染；缺失的变量渲染为空串
export function render(tpl, vars) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');
}

// 标点归一化：模型偶尔在中文句子里混用半角标点。
// 只在「前后都是中日韩汉字」时替换，避免误伤英文、代码、URL、数字。
export function normalizePunct(s) {
  return String(s || '')
    .replace(/([一-龥])\s*,\s*([一-龥])/g, '$1，$2')
    .replace(/([一-龥])\s*;\s*([一-龥])/g, '$1；$2')
    .replace(/([一-龥])\s*:\s*([一-龥])/g, '$1：$2')
    .replace(/([一-龥])\s*!\s*/g, '$1！')
    .replace(/([一-龥])\s*\?\s*/g, '$1？');
}

// 字符二元组集合（去掉空白、标点、符号）——中文没有分词时最便宜的相似度基础
export function bigrams(s) {
  const t = String(s || '').replace(/[\s\p{P}\p{S}]/gu, '');
  const out = new Set();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}

// 二元组 Jaccard 相似度，0~1；任一侧为空时返回 0
export function bigramJaccard(a, b) {
  const A = bigrams(a); const B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  return inter / (A.size + B.size - inter);
}

// 前台渲染器（apps/web/lib/markdown.tsx）不支持的块级语法里，能无损去掉的直接去掉：
// 分隔线删行、引用块去掉「>」前缀、代码块去掉围栏保留内容。表格没法机械转换，由调用方另行处理。
export function stripUnsupportedMarkup(content) {
  return String(content || '')
    .split('\n')
    .filter((l) => !/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l) && !/^\s*```/.test(l))
    .map((l) => l.replace(/^(\s*)>\s?/, '$1'))
    .join('\n');
}
export const TABLE_RE = /^\s*\|.*\|\s*$/m;

// 与 apps/cms/src/api/sensitive-word/services 保持一致：内置兜底词 + 后台启用词，扫标题+正文，忽略大小写
export const SENSITIVE_BUILTIN = ['敏感词测试', 'badword', '违禁示例'];
export function scanSensitive(words, art) {
  const text = `${art.title || ''}\n${art.content || ''}`.toLowerCase();
  return words.filter((w) => w && text.includes(w.toLowerCase()));
}
