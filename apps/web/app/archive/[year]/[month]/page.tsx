import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
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
  return <ArchiveMonthView year={ym.year} month={ym.month} page={1} />;
}
