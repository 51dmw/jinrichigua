'use client';

import { useState } from 'react';

/**
 * 社交分享。微博 / QQ空间走 URL 分享；微信无网页直分享接口，提供「复制链接」+ 提示。
 */
export function ShareButtons({ url, title }: { url: string; title: string }) {
  const [copied, setCopied] = useState(false);
  const [wechat, setWechat] = useState(false);

  const u = encodeURIComponent(url);
  const t = encodeURIComponent(title);
  const weibo = `https://service.weibo.com/share/share.php?url=${u}&title=${t}`;
  const qzone = `https://sns.qzone.qq.com/cgi-bin/qzshare/cgi_qzshare_onekey?url=${u}&title=${t}`;

  async function writeClipboard(text: string): Promise<boolean> {
    // 优先 Clipboard API（需 https + 较新浏览器）
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      /* 落到回退 */
    }
    // 回退：临时 textarea + execCommand，兼容微信/QQ 内置浏览器与非 https
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.readOnly = true;
      ta.style.position = 'fixed';
      ta.style.top = '0';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }

  async function copy() {
    if (await writeClipboard(url)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  const btn =
    'rounded-full border border-gray-200 px-3 py-1 text-xs text-gray-600 hover:border-brand hover:text-brand';

  return (
    <div className="relative mt-5 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4">
      <span className="text-xs text-gray-500">分享到：</span>
      <a href={weibo} target="_blank" rel="noopener noreferrer" className={btn}>
        微博
      </a>
      <a href={qzone} target="_blank" rel="noopener noreferrer" className={btn}>
        QQ空间
      </a>
      <button type="button" onClick={() => setWechat((v) => !v)} className={btn}>
        微信
      </button>
      <button type="button" onClick={copy} className={btn}>
        {copied ? '已复制' : '复制链接'}
      </button>

      {wechat ? (
        <div className="absolute top-full left-0 z-10 mt-2 w-72 rounded-lg border border-gray-200 bg-white p-3 text-xs shadow-lg">
          <p className="mb-2 text-gray-600">微信暂不支持网页直接分享，请复制链接后在微信中发送：</p>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={url}
              className="min-w-0 flex-1 rounded border border-gray-200 px-2 py-1 text-gray-500"
            />
            <button type="button" onClick={copy} className="shrink-0 rounded bg-brand px-2 py-1 text-white">
              {copied ? '已复制' : '复制'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
