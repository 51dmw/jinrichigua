import type { Metadata } from 'next';
import { TagView, tagMeta } from '@/components/TagView';

export const revalidate = 120;
export const dynamicParams = true;

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  return tagMeta(slug, 1);
}

export default async function TagPage({ params }: { params: Params }) {
  const { slug } = await params;
  return <TagView slug={slug} page={1} />;
}
