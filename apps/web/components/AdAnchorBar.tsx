'use client';

import Image from 'next/image';
import { useState } from 'react';
import { AD_LINK_REL, AD_LINK_TARGET } from '@/lib/adFormats';
import { AdRotator } from './AdRotator';

/**
 * 移动端底部悬浮广告条（仅移动：lg:hidden）。可关闭，关闭后本会话不再出现。
 * 320×50 标准 anchor 尺寸；fixed 不参与文档流，避免顶内容。
 * demoSrcs 非空时渲染展位图演示（多张则轮播），点击跳主域名（§M6）。
 */
export function AdAnchorBar({
  src,
  href,
  title,
  alt,
  demoSrcs,
  demoSeed,
}: {
  src?: string;
  href?: string;
  title?: string;
  alt?: string;
  /** 演示展位图（无真实创意时），多张轮播 */
  demoSrcs?: string[];
  demoSeed?: number;
}) {
  const [closed, setClosed] = useState(false);
  if (closed) return null;

  const demo = demoSrcs && demoSrcs.length > 0;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex justify-center bg-black/5 px-2 py-1 lg:hidden">
      {demo ? (
        <a
          href={href || '#'}
          target={AD_LINK_TARGET}
          rel={AD_LINK_REL}
          className="relative block w-full max-w-[320px] overflow-hidden rounded bg-white shadow"
          style={{ aspectRatio: '320 / 50' }}
          aria-label={`广告展位（示例）：${title ?? '推广'}`}
        >
          <AdRotator srcs={demoSrcs} alt={alt ?? '广告展位示例'} seed={demoSeed ?? 0} />
          <span className="absolute bottom-0.5 left-0.5 rounded bg-black/40 px-1 text-[10px] text-white">
            广告
          </span>
        </a>
      ) : (
        <a
          href={href || '#'}
          target={AD_LINK_TARGET}
          rel={AD_LINK_REL}
          className="relative block w-full max-w-[320px] overflow-hidden rounded bg-white shadow"
          style={{ aspectRatio: '320 / 50' }}
          aria-label={`广告：${title ?? '推广'}`}
        >
          {src ? (
            <Image src={src} alt={alt ?? '广告'} fill sizes="320px" className="object-cover" />
          ) : null}
          <span className="absolute bottom-0.5 left-0.5 rounded bg-black/40 px-1 text-[10px] text-white">
            广告
          </span>
        </a>
      )}
      <button
        type="button"
        onClick={() => setClosed(true)}
        aria-label="关闭广告"
        className="ml-1 flex h-6 w-6 shrink-0 items-center justify-center self-center rounded-full bg-black/40 text-sm leading-none text-white"
      >
        ×
      </button>
    </div>
  );
}
