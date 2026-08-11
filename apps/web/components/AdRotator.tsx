'use client';

import { useEffect, useState } from 'react';

/**
 * 演示展位图轮播（「同位置多展示图」）。
 * 多张图全部叠在父容器里（父容器负责宽高比），靠 opacity 切换 —— 不改布局、无 CLS。
 * 只有一张时退化成静态图，不起定时器。
 *
 * 用原生 <img> 而非 next/image：源是本站现生成的 SVG，走 next/image 需要开
 * dangerouslyAllowSVG，为一组占位图放开全站 SVG 优化不划算。
 */
export function AdRotator({
  srcs,
  alt = '',
  intervalMs = 4500,
  seed = 0,
}: {
  srcs: string[];
  alt?: string;
  intervalMs?: number;
  /** 错峰种子（一般传位置 key 的哈希），避免整页广告位同一秒集体翻页 */
  seed?: number;
}) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (srcs.length < 2) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const kickoff = setTimeout(
      () => {
        timer = setInterval(() => setActive((i) => (i + 1) % srcs.length), intervalMs);
      },
      (seed % srcs.length) * 800,
    );
    return () => {
      clearTimeout(kickoff);
      if (timer) clearInterval(timer);
    };
  }, [srcs.length, intervalMs, seed]);

  return (
    <>
      {srcs.map((src, i) => (
        // eslint-disable-next-line @next/next/no-img-element -- 本站现生成的 SVG，见组件头注释
        <img
          key={src}
          src={src}
          alt={i === 0 ? alt : ''}
          aria-hidden={i === 0 ? undefined : true}
          loading="lazy"
          decoding="async"
          // 尺寸走内联样式而非 class：正文里的 .article-body img 规则（h-auto/max-w-full/my-3）
          // 优先级高于 Tailwind 工具类，会把铺满容器的展位图挤成小方块。
          // 真实广告走 next/image 的 fill（同样是内联样式），所以从没暴露过这个坑。
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            maxWidth: 'none',
            margin: 0,
            objectFit: 'cover',
          }}
          className={`transition-opacity duration-700 ${i === active ? 'opacity-100' : 'opacity-0'}`}
        />
      ))}
    </>
  );
}
