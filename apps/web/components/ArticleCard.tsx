import Image from 'next/image';
import Link from 'next/link';
import type { ArticleListItem, BlockVariant } from 'shared';
import { mediaUrl, imageAlt } from '@/lib/strapi';
import { CoverPlaceholder } from './CoverPlaceholder';

function href(a: ArticleListItem): string {
  // 语义化短链 /{channelSlug}/{articleSlug}（§4，MUST NOT 用纯数字 ID）
  return `/${a.channel?.slug ?? 'news'}/${a.slug}`;
}

function Cover({
  a,
  sizes,
  priority,
}: {
  a: ArticleListItem;
  sizes: string;
  priority?: boolean;
}) {
  const url = mediaUrl(a.cover);
  if (!url) {
    return <CoverPlaceholder />;
  }
  return (
    <Image
      src={url}
      alt={imageAlt(a.cover, a.title)}
      fill
      sizes={sizes}
      priority={priority}
      // Next 15 的 priority 只负责「不 lazy + 发 preload」，不会给 <img> 加 fetchpriority
      // （见 next/dist/shared/lib/get-img-props.js：fetchPriority 是独立入参）。
      // LCP 图要显式抬到 high，否则仍排在同批图片的默认优先级里。
      fetchPriority={priority ? 'high' : undefined}
      className="object-cover"
    />
  );
}

/**
 * 单条卡片，按 variant 切换版式（§5 卡片 variant 由数据驱动）。
 * headingLevel：标题语义级别。列表页（频道/标签/作者/搜索）卡片直属 h1 → 传 2；
 * 首页区块、相关推荐在 h2 小节下 → 默认 3。保证 H 层级不跳级（SEO/无障碍）。
 */
export function ArticleCard({
  article,
  variant,
  priority,
  headingLevel = 3,
}: {
  article: ArticleListItem;
  variant: BlockVariant;
  priority?: boolean;
  headingLevel?: 2 | 3;
}) {
  const Heading = `h${headingLevel}` as 'h2' | 'h3';
  // 大图卡
  if (variant === 'hero') {
    return (
      <Link href={href(article)} className="block">
        <article className="overflow-hidden rounded-lg bg-white shadow-sm">
          <div className="relative aspect-[16/9] w-full">
            <Cover a={article} sizes="(max-width: 640px) 100vw, 640px" priority={priority} />
          </div>
          <div className="p-3">
            <Heading className="text-lg font-bold leading-snug text-gray-900">{article.title}</Heading>
            {article.summary ? (
              <p className="mt-1 line-clamp-2 text-sm text-gray-500">{article.summary}</p>
            ) : null}
          </div>
        </article>
      </Link>
    );
  }

  // 纯文字
  if (variant === 'text-only') {
    return (
      <Link href={href(article)} className="block py-2.5">
        <article className="flex items-start gap-2">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-hidden />
          <div className="min-w-0">
            <Heading className="line-clamp-1 text-[15px] font-medium leading-snug text-gray-900">
              {article.title}
            </Heading>
            {article.summary ? (
              <p className="mt-0.5 line-clamp-1 text-xs text-gray-500">{article.summary}</p>
            ) : null}
          </div>
        </article>
      </Link>
    );
  }

  // 上图下标题：图在上、标题在下（用于 2 列 grid，图比三图大）
  if (variant === 'image-top') {
    return (
      <Link href={href(article)} className="block">
        <article className="overflow-hidden rounded-lg bg-white shadow-sm">
          <div className="relative aspect-[16/10] w-full">
            <Cover a={article} sizes="(max-width: 640px) 50vw, 320px" priority={priority} />
          </div>
          <Heading className="line-clamp-2 px-2 py-2 text-sm font-medium leading-snug text-gray-900">
            {article.title}
          </Heading>
        </article>
      </Link>
    );
  }

  // 三图：图上文下的紧凑卡（用于 grid 容器）
  if (variant === 'three-image') {
    return (
      <Link href={href(article)} className="block">
        <article>
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded">
            <Cover a={article} sizes="(max-width: 640px) 33vw, 200px" />
          </div>
          <Heading className="mt-1.5 line-clamp-2 text-xs leading-snug text-gray-900">{article.title}</Heading>
        </article>
      </Link>
    );
  }

  // left-text-right-image（默认）
  return (
    <Link href={href(article)} className="block py-2.5">
      <article className="flex items-stretch gap-3">
        <div className="min-w-0 flex-1">
          <Heading className="line-clamp-2 text-base font-medium leading-snug text-gray-900">
            {article.title}
          </Heading>
          <p className="mt-2 text-xs text-gray-500">
            {article.channel?.name ?? ''} {article.source ? `· ${article.source}` : ''}
          </p>
        </div>
        <div className="relative aspect-[4/3] w-28 shrink-0 overflow-hidden rounded">
          <Cover a={article} sizes="112px" />
        </div>
      </article>
    </Link>
  );
}
