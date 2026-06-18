import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
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
  if (!ym || page < 2) notFound(); // 第 1 页走 /archive/{year}/{month}
  return <ArchiveMonthView year={ym.year} month={ym.month} page={page} />;
}
