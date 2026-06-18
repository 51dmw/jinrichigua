import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getAllPageSlugs, getGlobal, getPageBySlug, getPopularTags } from '@/lib/strapi';
import { resolveMetadata } from '@/lib/seo';
import { Breadcrumb } from '@/components/Breadcrumb';
import { TagChip } from '@/components/TagChip';

export const revalidate = 600;
export const dynamicParams = true; // 后台新增页面无需重新部署即可访问

export async function generateStaticParams() {
  const slugs = await getAllPageSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const [page, global] = await Promise.all([getPageBySlug(slug), getGlobal()]);
  if (!page) return {};
  return resolveMetadata({
    seo: page.seo,
    global,
    fallbackTitle: page.title,
    fallbackDescription: (page.body ?? '').split('\n').find(Boolean) ?? page.title,
    path: `/info/${slug}`,
  });
}

export default async function InfoPageRoute({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await getPageBySlug(slug);
  if (!page) notFound();

  // 热门搜索页：额外列出热门标签作为关键词内链
  const tags = slug === 'hot-search' ? await getPopularTags(20) : [];

  const paragraphs = (page.body ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  return (
    <div className="mx-auto w-full max-w-screen">
      <Breadcrumb
        items={[
          { name: '首页', path: '/' },
          { name: page.title, path: `/info/${slug}` },
        ]}
      />
      <article className="rounded-lg bg-white p-4">
        <h1 className="mb-3 text-xl font-bold text-gray-900">{page.title}</h1>
        <div className="article-body">
          {paragraphs.map((p, i) => (
            <p key={i}>{p.replace(/^#+\s*/, '')}</p>
          ))}
        </div>

        {tags.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {tags.map((t) => (
              <TagChip key={t.documentId} slug={t.slug} name={t.name} />
            ))}
          </div>
        ) : null}
      </article>
    </div>
  );
}
