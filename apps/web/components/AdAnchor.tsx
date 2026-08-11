import { getAdSlot, mediaUrl, imageAlt } from '@/lib/strapi';
import { AdAnchorBar } from './AdAnchorBar';
import { adDemoSrcs, slotSeed, formatForSlot } from '@/lib/adFormats';
import { ADS_PLACEHOLDER, SITE_URL } from '@/lib/env';

/**
 * 移动端悬浮广告位（服务端取投放 → 客户端悬浮条）。
 * 有创意渲染真实广告；无创意时占位图模式渲染展位图演示（多张轮播，跳主域名），否则不渲染。
 */
export async function AdAnchor({ slotKey }: { slotKey: string }) {
  const slot = await getAdSlot(slotKey);
  const img = slot ? mediaUrl(slot.image) : null;

  if (img && slot) {
    const title = slot.title ?? '推广';
    return (
      <AdAnchorBar
        src={img}
        href={slot.link || '#'}
        title={title}
        alt={imageAlt(slot.image, `广告 - ${title}`)}
      />
    );
  }

  if (!ADS_PLACEHOLDER) return null;
  return (
    <AdAnchorBar
      href={SITE_URL}
      title={slotKey}
      alt={`广告展位示例 - ${slotKey}`}
      demoSrcs={adDemoSrcs(slotKey, formatForSlot(slotKey, slot?.format))}
      demoSeed={slotSeed(slotKey)}
    />
  );
}
