import type { Metadata } from 'next';
import { getAllAuthorSlugs } from '@/lib/strapi';
import { AuthorView, authorMeta } from '@/components/AuthorView';

export const revalidate = 120;
export const dynamicParams = true;

export async function generateStaticParams() {
  const slugs = await getAllAuthorSlugs();
  return slugs.map((slug) => ({ slug }));
}

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  return authorMeta(slug, 1);
}

export default async function AuthorPage({ params }: { params: Params }) {
  const { slug } = await params;
  return <AuthorView slug={slug} page={1} />;
}
