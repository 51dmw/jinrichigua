import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getAllPageSlugs, getGlobal, getPageBySlug, getPopularTags } from '@/lib/strapi';
import { resolveMetadata, faqJsonLd } from '@/lib/seo';
import { JsonLd } from '@/components/JsonLd';
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

  // 问答体页面（如 /info/faq，后台正文每段是「问：…答：…」）：整页都是这种段落时，
  // 渲染成「问句小标题 + 答案段落」并输出 FAQPage；只要有一段不符合就按普通段落处理。
  const qa = paragraphs.map((p) => {
    const m = /^问[：:]\s*(.+?)\s*答[：:]\s*(.+)$/.exec(p);
    return m ? { q: m[1], a: m[2] } : null;
  });
  const isFaq = qa.length > 0 && qa.every(Boolean);
  const faq = isFaq ? (qa as Array<{ q: string; a: string }>) : [];

  return (
    <div className="mx-auto w-full max-w-screen">
      <Breadcrumb
        items={[
          { name: '首页', path: '/' },
          { name: page.title, path: `/info/${slug}` },
        ]}
      />
      {isFaq ? <JsonLd data={faqJsonLd(faq, `/info/${slug}`)} /> : null}
      <article className="rounded-lg bg-white p-4">
        <h1 className="mb-3 text-xl font-bold text-gray-900">{page.title}</h1>
        <div className="article-body">
          {isFaq
            ? faq.map(({ q, a }, i) => (
                <section key={i}>
                  <h2>{q}</h2>
                  <p>{a}</p>
                </section>
              ))
            : paragraphs.map((p, i) => <p key={i}>{p.replace(/^#+\s*/, '')}</p>)}
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
