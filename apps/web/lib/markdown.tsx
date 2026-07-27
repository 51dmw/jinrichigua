import type { ReactNode } from 'react';
import Link from 'next/link';

/**
 * 受限 markdown 渲染（只支持二创管线会产出的语法子集）。
 *
 * 背景：此前正文按行无差别包 <p> 且主动剥掉行首 `#`，导致小标题、内链、
 * 配图、加粗全部失效——搜索引擎看不到任何正文层级结构（详见
 * docs/seo-training/GAP.md 勘误段）。
 *
 * 安全模型：全程输出 React 元素，不使用 dangerouslySetInnerHTML，
 * 文本天然转义；URL 走白名单（站内相对路径 / http(s) 绝对地址），
 * 其余（javascript: 等）降级为纯文本。
 *
 * 支持：## ~ ###### 标题、- / * 列表、[文本](链接)、![alt](图片)、**加粗**
 */

/** 站内路径：/ 开头，只允许字母数字连字符斜杠下划线 */
const INTERNAL_PATH = /^\/[\w\-/]*$/;
const EXTERNAL_URL = /^https?:\/\/[^\s]+$/i;

export function renderArticleMarkdown(md: string): ReactNode[] {
  const lines = String(md ?? '').split('\n');
  const out: ReactNode[] = [];
  let listBuf: ReactNode[] = [];

  const flushList = () => {
    if (!listBuf.length) return;
    out.push(
      <ul key={`ul-${out.length}`} className="my-3 list-disc pl-5">
        {listBuf}
      </ul>,
    );
    listBuf = [];
  };

  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;

    // 独立成行的图片
    const img = line.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
    if (img && EXTERNAL_URL.test(img[2])) {
      flushList();
      out.push(
        // eslint-disable-next-line @next/next/no-img-element -- 正文配图尺寸不定，不走 next/image
        <img key={`img-${i}`} src={img[2]} alt={img[1] || ''} loading="lazy" decoding="async" />,
      );
      return;
    }

    // 标题层级：页面 h1 已被文章标题占用（保证 H1 唯一），正文里的 # 提升为 h2；
    // ## → h2、### → h3、更深 → h4。不跳级（p045：H 标签按逻辑递进）。
    const h = line.match(/^(#{1,6})\s+(.+)$/);
    if (h) {
      flushList();
      const level = Math.min(Math.max(h[1].length, 2), 4);
      const Tag = (level === 2 ? 'h2' : level === 3 ? 'h3' : 'h4') as 'h2' | 'h3' | 'h4';
      out.push(<Tag key={`h-${i}`}>{inline(h[2], `h-${i}`)}</Tag>);
      return;
    }

    // 列表项
    if (/^[-*]\s+/.test(line)) {
      listBuf.push(<li key={`li-${i}`}>{inline(line.replace(/^[-*]\s+/, ''), `li-${i}`)}</li>);
      return;
    }

    flushList();
    out.push(<p key={`p-${i}`}>{inline(line, `p-${i}`)}</p>);
  });

  flushList();
  return out;
}

/** 行内语法：**加粗** 与 [文本](链接)；其余原样输出为文本节点 */
function inline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let n = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));

    if (m[1] !== undefined) {
      nodes.push(<strong key={`${keyBase}-b${n}`}>{m[1]}</strong>);
    } else {
      const label = m[2];
      const href = m[3];
      if (INTERNAL_PATH.test(href)) {
        nodes.push(
          <Link key={`${keyBase}-a${n}`} href={href} className="text-brand underline">
            {label}
          </Link>,
        );
      } else if (EXTERNAL_URL.test(href)) {
        // 外链一律 nofollow，防权重外泄（SEO 规范 p045）
        nodes.push(
          <a
            key={`${keyBase}-a${n}`}
            href={href}
            rel="nofollow noopener noreferrer"
            target="_blank"
            className="text-brand underline"
          >
            {label}
          </a>,
        );
      } else {
        nodes.push(label); // 非白名单 URL（javascript: 等）→ 只留文字
      }
    }

    last = m.index + m[0].length;
    n += 1;
  }

  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}
