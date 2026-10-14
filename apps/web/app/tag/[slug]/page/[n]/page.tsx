import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { TagView, tagMeta } from '@/components/TagView';

export const revalidate = 120;
export const dynamicParams = true;

type Params = Promise<{ slug: string; n: string }>;

function parsePage(n: string): number | null {
  const p = Number(n);
  if (!Number.isInteger(p) || p < 2) return null;
  return p;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug, n } = await params;
  const page = parsePage(n);
  if (page === null) return {};
  return tagMeta(slug, page);
}

export default async function TagPagedPage({ params }: { params: Params }) {
  const { slug, n } = await params;
  // /page/1 与第 1 页重复 → 永久跳回规范地址
  if (n === '1') permanentRedirect(`/tag/${slug}`);
  const page = parsePage(n);
  if (page === null) notFound();
  return <TagView slug={slug} page={page} />;
}
