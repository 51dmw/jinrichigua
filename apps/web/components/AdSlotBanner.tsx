import Image from 'next/image';
import { getAdSlot, mediaUrl, imageAlt } from '@/lib/strapi';
import { adFormatSpec, formatForSlot, AD_LINK_REL, AD_LINK_TARGET } from '@/lib/adFormats';
import { ADS_PLACEHOLDER } from '@/lib/env';

/**
 * 广告位（§M6）。按 key 取后台投放，按 format 渲染标准占位尺寸。
 * - 有创意图 → 渲染真实广告（fill + sizes + alt + 懒加载，rel=sponsored + 「广告」角标）。
 * - 无创意：占位图模式（ADS_PLACEHOLDER）下渲染「占位框」，否则不渲染（不留空位）。
 * - 容器按格式固定宽高比，加载前即预留高度 → CLS≈0。
 */
export async function AdSlotBanner({ slotKey }: { slotKey: string }) {
  const slot = await getAdSlot(slotKey);
  const img = slot ? mediaUrl(slot.image) : null;
  const spec = adFormatSpec(formatForSlot(slotKey, slot?.format));

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

  // 无创意：占位图模式才渲染占位框，否则不占位
  if (!ADS_PLACEHOLDER) return null;
  return (
    <div className={spec.visibility}>
      <div
        className="mb-3 mx-auto flex w-full items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 text-gray-500"
        style={{ maxWidth: spec.maxWidth ?? undefined, aspectRatio: spec.ratio }}
        aria-hidden="true"
      >
        <span className="px-2 text-center text-[11px] leading-4">
          广告位 · {spec.label}
          <br />
          {slotKey}
        </span>
      </div>
    </div>
  );
}
