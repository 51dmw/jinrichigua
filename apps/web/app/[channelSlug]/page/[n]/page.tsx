import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { ChannelView, channelMeta } from '@/components/ChannelView';

export const revalidate = 120;
export const dynamicParams = true;

type Params = Promise<{ channelSlug: string; n: string }>;

function parsePage(n: string): number | null {
  const p = Number(n);
  // 第 1 页在 /{channelSlug}，这里只接受 ≥2 的整数，避免重复内容
  if (!Number.isInteger(p) || p < 2) return null;
  return p;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { channelSlug, n } = await params;
  const page = parsePage(n);
  if (page === null) return {};
  return channelMeta(channelSlug, page);
}

export default async function ChannelPagedPage({ params }: { params: Params }) {
  const { channelSlug, n } = await params;
  // /page/1 与第 1 页重复 → 永久跳回规范地址
  if (n === '1') permanentRedirect(`/${channelSlug}`);
  const page = parsePage(n);
  if (page === null) notFound();
  return <ChannelView channelSlug={channelSlug} page={page} />;
}
