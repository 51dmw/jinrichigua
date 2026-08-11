import Image from 'next/image';
import { getAdSlot, mediaUrl, imageAlt } from '@/lib/strapi';
import {
  adFormatSpec,
  formatForSlot,
  adDemoSrcs,
  slotSeed,
  AD_LINK_REL,
  AD_LINK_TARGET,
} from '@/lib/adFormats';
import { ADS_PLACEHOLDER, SITE_URL } from '@/lib/env';
import { AdRotator } from './AdRotator';

/**
 * 广告位（§M6）。按 key 取后台投放，按 format 渲染标准占位尺寸。
 * - 有创意图 → 渲染真实广告（fill + sizes + alt + 懒加载，rel=sponsored + 「广告」角标）。
 * - 无创意：占位图模式（ADS_PLACEHOLDER）下渲染「展位图」演示（同位置多张则轮播，
 *   点击跳主域名），否则不渲染（不留空位）。
 * - 容器按格式固定宽高比，加载前即预留高度 → CLS≈0。
 */
export async function AdSlotBanner({ slotKey }: { slotKey: string }) {
  const slot = await getAdSlot(slotKey);
  const img = slot ? mediaUrl(slot.image) : null;
  const fmt = formatForSlot(slotKey, slot?.format);
  const spec = adFormatSpec(fmt);

  // 真实创意优先
  if (img && slot) {
    return (
      <div className={spec.visibility}>
        <a
          href={slot.link || '#'}
          target={AD_LINK_TARGET}
          rel={AD_LINK_REL}
          className="mb-3 mx-auto block w-full overflow-hidden rounded-lg bg-white"
          style={{ maxWidth: spec.maxWidth ?? undefined }}
          aria-label={`广告：${slot.title ?? '推广'}`}
        >
          <div className="relative w-full" style={{ aspectRatio: spec.ratio }}>
            <Image
              src={img}
              alt={imageAlt(slot.image, slot.title ? `广告 - ${slot.title}` : '广告')}
              fill
              sizes={spec.sizes}
              loading="lazy"
              className="object-cover"
            />
            <span className="absolute bottom-1 right-1 rounded bg-black/40 px-1 text-[10px] text-white">
              广告
            </span>
          </div>
        </a>
      </div>
    );
  }

  // 无创意：占位图模式才渲染展位图演示，否则不占位
  if (!ADS_PLACEHOLDER) return null;
  return (
    <div className={spec.visibility}>
      <a
        href={SITE_URL}
        target={AD_LINK_TARGET}
        rel={AD_LINK_REL}
        className="mb-3 mx-auto block w-full overflow-hidden rounded-lg bg-white"
        style={{ maxWidth: spec.maxWidth ?? undefined }}
        aria-label={`广告展位（示例）：${slotKey}`}
      >
        <div className="relative w-full" style={{ aspectRatio: spec.ratio }}>
          <AdRotator
            srcs={adDemoSrcs(slotKey, fmt)}
            alt={`广告展位示例 - ${slotKey}`}
            seed={slotSeed(slotKey)}
          />
          <span className="absolute bottom-1 right-1 rounded bg-black/40 px-1 text-[10px] text-white">
            广告
          </span>
        </div>
      </a>
    </div>
  );
}
