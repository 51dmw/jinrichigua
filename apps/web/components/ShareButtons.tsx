'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * 社交分享，纯自建：只用各平台公开的 URL 分享入口 + 内联 SVG 图标，不加载第三方脚本（无需改 CSP）。
 * - 微信无网页分享接口：弹出链接 + 复制；微信内置浏览器里改为提示右上角菜单。
 * - 移动端额外提供「短信」与系统分享（navigator.share）。
 */
export function ShareButtons({ url, title }: { url: string; title: string }) {
  const [copied, setCopied] = useState(false);
  const [wechatOpen, setWechatOpen] = useState(false);
  // 环境探测只在挂载后做，避免 SSR 与客户端渲染不一致
  const [env, setEnv] = useState({ mobile: false, inWechat: false, nativeShare: false });
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ua = navigator.userAgent;
    setEnv({
      mobile: /Android|iPhone|iPad|iPod|Mobile/i.test(ua),
      inWechat: /MicroMessenger/i.test(ua),
      nativeShare: typeof navigator.share === 'function',
    });
  }, []);

  // 切换文章时收起面板
  useEffect(() => {
    setWechatOpen(false);
  }, [url]);

  // 点外部或 Esc 关闭微信面板
  useEffect(() => {
    if (!wechatOpen) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setWechatOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setWechatOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [wechatOpen]);

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

  async function nativeShare() {
    try {
      await navigator.share({ title, url });
    } catch {
      /* 用户取消或不支持，忽略 */
    }
  }

  const u = encodeURIComponent(url);
  const t = encodeURIComponent(title);
  const links = [
    { key: 'weibo', label: '微博', color: '#E6162D', icon: icons.weibo, href: `https://service.weibo.com/share/share.php?url=${u}&title=${t}` },
    { key: 'qzone', label: 'QQ空间', color: '#F5B400', icon: icons.qzone, href: `https://sns.qzone.qq.com/cgi-bin/qzshare/cgi_qzshare_onekey?url=${u}&title=${t}` },
    { key: 'telegram', label: 'Telegram', color: '#26A5E4', icon: icons.telegram, href: `https://t.me/share/url?url=${u}&text=${t}` },
    { key: 'x', label: 'X', color: '#000000', icon: icons.x, href: `https://twitter.com/intent/tweet?url=${u}&text=${t}` },
    { key: 'facebook', label: 'Facebook', color: '#1877F2', icon: icons.facebook, href: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
  ];

  const circle =
    'inline-flex h-8 w-8 items-center justify-center rounded-full text-white transition-opacity hover:opacity-80';

  return (
    <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4">
      <span className="text-xs text-gray-500">分享到：</span>

      <div ref={panelRef} className="relative">
        <button
          type="button"
          onClick={() => setWechatOpen((v) => !v)}
          aria-expanded={wechatOpen}
          aria-label="分享到微信"
          title="微信"
          className={circle}
          style={{ backgroundColor: '#07C160' }}
        >
          {icons.wechat}
        </button>
        {wechatOpen ? (
          <div className="absolute top-full left-0 z-10 mt-2 w-72 rounded-lg border border-gray-200 bg-white p-3 text-xs shadow-lg">
            <p className="mb-2 text-gray-600">
              {env.inWechat
                ? '点击右上角「···」即可发送给朋友或分享到朋友圈，也可复制链接：'
                : '微信暂不支持网页直接分享，请复制链接后在微信中发送：'}
            </p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={url}
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 rounded border border-gray-200 px-2 py-1 text-gray-500"
              />
              <button type="button" onClick={copy} className="shrink-0 rounded bg-brand px-2 py-1 text-white">
                {copied ? '已复制' : '复制'}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {links.map((l) => (
        <a
          key={l.key}
          href={l.href}
          target="_blank"
          rel="nofollow noopener noreferrer"
          aria-label={`分享到${l.label}`}
          title={l.label}
          className={circle}
          style={{ backgroundColor: l.color }}
        >
          {l.icon}
        </a>
      ))}

      {env.mobile ? (
        <a
          href={`sms:?&body=${encodeURIComponent(`${title} ${url}`)}`}
          rel="nofollow"
          aria-label="短信分享"
          title="短信"
          className={circle}
          style={{ backgroundColor: '#34C759' }}
        >
          {icons.sms}
        </a>
      ) : null}

      <button
        type="button"
        onClick={copy}
        aria-label="复制链接"
        title={copied ? '已复制' : '复制链接'}
        className={circle}
        style={{ backgroundColor: copied ? '#07C160' : '#6B7280' }}
      >
        {copied ? icons.check : icons.link}
      </button>

      {env.nativeShare ? (
        <button
          type="button"
          onClick={nativeShare}
          aria-label="更多分享方式"
          title="更多"
          className={circle}
          style={{ backgroundColor: '#9CA3AF' }}
        >
          {icons.more}
        </button>
      ) : null}
    </div>
  );
}

/** 自绘简化图标，统一 24×24 画布、白色前景，背景色由外层圆形按钮提供。 */
function Svg({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden focusable="false">
      {children}
    </svg>
  );
}

const icons = {
  wechat: (
    <Svg>
      <ellipse cx="9.5" cy="9.5" rx="7.5" ry="6" />
      <path d="M5 14l-1 3 3.5-1.8z" />
      <circle cx="7" cy="8.5" r="1" fill="#07C160" />
      <circle cx="12" cy="8.5" r="1" fill="#07C160" />
      <ellipse cx="15.5" cy="14.5" rx="6.3" ry="5" stroke="#07C160" strokeWidth="1.2" />
      <path d="M19.5 18.5l1 2.5-3-1.5z" />
      <circle cx="13.5" cy="13.8" r=".85" fill="#07C160" />
      <circle cx="17.5" cy="13.8" r=".85" fill="#07C160" />
    </Svg>
  ),
  weibo: (
    <Svg>
      <ellipse cx="10" cy="14.5" rx="8" ry="5.5" />
      <ellipse cx="9.5" cy="15" rx="3" ry="2.3" fill="#E6162D" />
      <circle cx="9" cy="15.2" r="1" />
      <path d="M15 3.5a6 6 0 0 1 6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M15 7a2.5 2.5 0 0 1 2.5 2.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </Svg>
  ),
  qzone: (
    <Svg>
      <polygon points="12,3 14.23,8.93 20.56,9.22 15.61,13.17 17.29,19.28 12,15.8 6.71,19.28 8.39,13.17 3.44,9.22 9.77,8.93" />
    </Svg>
  ),
  telegram: (
    <Svg>
      <path d="M21.4 4.2 2.9 11.4c-1 .4-1 1.5 0 1.8l4.6 1.4 1.8 5.5c.2.7 1.1.9 1.6.4l2.6-2.4 4.8 3.5c.7.5 1.6.1 1.8-.7l3.1-14.9c.2-1-.7-1.8-1.6-1.4zM9.8 14.4l8.4-7.6-6.6 8.9-.4 3z" />
    </Svg>
  ),
  x: (
    <Svg>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </Svg>
  ),
  facebook: (
    <Svg>
      <path d="M13.5 21v-8.2h2.8l.4-3.3h-3.2V7.4c0-.9.3-1.6 1.6-1.6h1.7V2.9c-.3 0-1.3-.1-2.5-.1-2.5 0-4.2 1.5-4.2 4.3v2.4H7.3v3.3h2.8V21z" />
    </Svg>
  ),
  sms: (
    <Svg>
      <path d="M4 4.5h16A1.5 1.5 0 0 1 21.5 6v10a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5v-3.5H4A1.5 1.5 0 0 1 2.5 16V6A1.5 1.5 0 0 1 4 4.5z" />
      <circle cx="8" cy="11" r="1.2" fill="#34C759" />
      <circle cx="12" cy="11" r="1.2" fill="#34C759" />
      <circle cx="16" cy="11" r="1.2" fill="#34C759" />
    </Svg>
  ),
  link: (
    <Svg>
      <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </g>
    </Svg>
  ),
  check: (
    <Svg>
      <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  ),
  more: (
    <Svg>
      <circle cx="5.5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="18.5" cy="12" r="2" />
    </Svg>
  ),
};
