import type { Metadata } from 'next';
import Link from 'next/link';
import {
  AD_SLOT_CATALOG,
  type AdSlotEntry,
  adFormatSpec,
  adDemoSrcs,
  slotSeed,
  AD_LINK_REL,
  AD_LINK_TARGET,
} from '@/lib/adFormats';
import { AdRotator } from '@/components/AdRotator';
import { getAdSlot } from '@/lib/strapi';
import { ADS_PLACEHOLDER, SITE_URL } from '@/lib/env';

/**
 * 广告位总览（演示页）。一页列全所有位置的展位图：位置 key、规格尺寸、所在页面、
 * 同位置的多张创意（轮播 + 全部平铺）。点击跳主域名。
 * 内部/对外演示用，MUST noindex —— 全是占位素材，进索引只会稀释站点质量。
 */

export const revalidate = 300;

export const metadata: Metadata = {
  title: '广告位总览（演示）',
  robots: { index: false, follow: false },
};

const TOTAL_SLOTS = AD_SLOT_CATALOG.reduce((n, p) => n + p.slots.length, 0);
const TOTAL_CREATIVES = AD_SLOT_CATALOG.reduce(
  (n, p) => n + p.slots.reduce((m, s) => m + Math.max(1, s.demo), 0),
  0,
);

/** 单个位置卡片：上方按真实宽高比轮播，下方平铺该位置的全部展位图。 */
async function SlotCard({ entry }: { entry: AdSlotEntry }) {
  const { key: slotKey, where, demo } = entry;
  const live = await getAdSlot(slotKey);
  const srcs = adDemoSrcs(slotKey, entry.format);
  const format = adFormatSpec(entry.format);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-bold text-gray-800">
          {slotKey}
        </code>
        <span className="text-xs text-gray-500">{format.label}</span>
        <span className="text-xs text-gray-400">
          {format.width}×{format.height}
        </span>
        {demo > 1 ? (
          <span className="rounded bg-brand/10 px-1.5 py-0.5 text-[11px] text-brand">
            {demo} 张轮播
          </span>
        ) : null}
        {live?.image ? (
          <span className="rounded bg-green-50 px-1.5 py-0.5 text-[11px] text-green-700">
            后台已有创意
          </span>
        ) : (
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500">
            后台未投放
          </span>
        )}
        {format.visibility ? (
          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700">
            {format.visibility === 'lg:hidden' ? '仅移动端' : '仅桌面端'}
          </span>
        ) : null}
      </div>
      <p className="mb-2 text-xs text-gray-500">{where}</p>

      {/* 实际观感：按该规格的宽高比轮播（与站内渲染完全一致） */}
      <a
        href={SITE_URL}
        target={AD_LINK_TARGET}
        rel={AD_LINK_REL}
        className="mx-auto block w-full overflow-hidden rounded bg-white"
        // in-feed 是 1200×628，按卡片满宽铺会把总览页撑得很长，这里收一收（站内仍是标准尺寸）。
        style={{ maxWidth: format.maxWidth ?? (entry.format === 'in-feed' ? '420px' : undefined) }}
        aria-label={`广告展位（示例）：${slotKey}`}
      >
        <div className="relative w-full" style={{ aspectRatio: format.ratio }}>
          <AdRotator
            srcs={srcs}
            alt={`广告展位示例 - ${slotKey}`}
            seed={slotSeed(slotKey)}
          />
          <span className="absolute bottom-1 right-1 rounded bg-black/40 px-1 text-[10px] text-white">
            广告
          </span>
        </div>
      </a>

      {/* 同位置的全部展位图平铺，一眼看全不用等轮播 */}
      {srcs.length > 1 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {srcs.map((src, i) => (
            <a
              key={src}
              href={src}
              target="_blank"
              rel="noopener noreferrer"
              className="block overflow-hidden rounded border border-gray-200"
              title={`第 ${i + 1} 张`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- 本站现生成的 SVG 占位图 */}
              <img
                src={src}
                alt={`${slotKey} 展位图 ${i + 1}`}
                loading="lazy"
                decoding="async"
                className="h-14 w-auto max-w-[180px] object-contain"
              />
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function AdsPreviewPage() {
  return (
    <div>
      <h1 className="mb-1 text-xl font-bold text-gray-900">广告位总览（演示）</h1>
      <p className="mb-3 text-sm text-gray-500">
        全站共 {AD_SLOT_CATALOG.length} 类页面、{TOTAL_SLOTS} 个广告位、{TOTAL_CREATIVES}{' '}
        张演示展位图。展位图点击跳转主域名 <code className="text-gray-700">{SITE_URL}</code>
        ，仅用于版位演示。
      </p>

      {!ADS_PLACEHOLDER ? (
        <p className="mb-4 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          注意：环境变量 <code>ADS_PLACEHOLDER</code> 未开启，站内实际页面上这些无创意的位置
          <b>不会</b>显示展位图（本总览页不受该开关影响）。要在站内也看到，设{' '}
          <code>ADS_PLACEHOLDER=1</code> 后重新发布前台。
        </p>
      ) : null}

      <div className="space-y-6">
        {AD_SLOT_CATALOG.map((group) => (
          <section key={group.page}>
            <h2 className="mb-2 flex items-baseline gap-2 border-b border-gray-200 pb-1 text-base font-bold text-gray-900">
              {group.page}
              <Link href={group.sample} className="text-xs font-normal text-brand">
                查看实际页面 {group.sample}
              </Link>
              <span className="text-xs font-normal text-gray-400">
                {group.slots.length} 个位置
              </span>
            </h2>
            <div className="grid items-start gap-3 sm:grid-cols-2">
              {group.slots.map((s) => (
                <SlotCard key={s.key} entry={s} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
