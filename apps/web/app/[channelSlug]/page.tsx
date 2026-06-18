import type { Metadata } from 'next';
import { getAllChannelSlugs } from '@/lib/strapi';
import { ChannelView, channelMeta } from '@/components/ChannelView';

export const revalidate = 120; // ISR（§5）
export const dynamicParams = true;

export async function generateStaticParams() {
  const slugs = await getAllChannelSlugs();
  return slugs.map((channelSlug) => ({ channelSlug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ channelSlug: string }>;
}): Promise<Metadata> {
  const { channelSlug } = await params;
  return channelMeta(channelSlug, 1);
}

export default async function ChannelPage({
  params,
}: {
  params: Promise<{ channelSlug: string }>;
}) {
  const { channelSlug } = await params;
  return <ChannelView channelSlug={channelSlug} page={1} />;
}
