import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { ArchiveMonthView, archiveMonthMeta, parseYearMonth } from '@/components/ArchiveMonthView';

export const revalidate = 300;
export const dynamicParams = true;

type Params = Promise<{ year: string; month: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { year, month } = await params;
  const ym = parseYearMonth(year, month);
  if (!ym) return {};
  return archiveMonthMeta(ym.year, ym.month, 1);
}

export default async function ArchiveMonthPage({ params }: { params: Params }) {
  const { year, month } = await params;
  const ym = parseYearMonth(year, month);
  if (!ym) notFound();
  // 月份补零（/archive/2026/09）→ 永久跳到规范地址 /archive/2026/9
  if (year !== String(ym.year) || month !== String(ym.month)) {
    permanentRedirect(`/archive/${ym.year}/${ym.month}`);
  }
  return <ArchiveMonthView year={ym.year} month={ym.month} page={1} />;
}
