import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { ArchiveMonthView, archiveMonthMeta, parseYearMonth } from '@/components/ArchiveMonthView';

export const revalidate = 300;
export const dynamicParams = true;

type Params = Promise<{ year: string; month: string; n: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { year, month, n } = await params;
  const ym = parseYearMonth(year, month);
  if (!ym) return {};
  return archiveMonthMeta(ym.year, ym.month, Math.max(1, Number(n) || 1));
}

export default async function ArchiveMonthPagedPage({ params }: { params: Params }) {
  const { year, month, n } = await params;
  const ym = parseYearMonth(year, month);
  const page = Number(n) || 0;
  if (!ym) notFound();
  // 非规范写法（/page/1、月份补零 /09）→ 永久跳到规范地址
  if (n === '1') permanentRedirect(`/archive/${ym.year}/${ym.month}`);
  if (year !== String(ym.year) || month !== String(ym.month)) {
    permanentRedirect(`/archive/${ym.year}/${ym.month}/page/${n}`);
  }
  if (page < 2) notFound(); // 第 1 页走 /archive/{year}/{month}
  return <ArchiveMonthView year={ym.year} month={ym.month} page={page} />;
}
