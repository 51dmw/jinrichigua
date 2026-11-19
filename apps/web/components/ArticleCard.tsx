import Image from 'next/image';
import Link from 'next/link';
import type { ArticleListItem, BlockVariant } from 'shared';
import { mediaUrl, imageAlt } from '@/lib/strapi';
import { CoverPlaceholder } from './CoverPlaceholder';

function href(a: ArticleListItem): string {
  // 语义化短链 /{channelSlug}/{articleSlug}（§4，MUST NOT 用纯数字 ID）
  return `/${a.channel?.slug ?? 'news'}/${a.slug}`;
}

const CARD_TAG_LIMIT = 2;
/** 热榜平台类泛标签：信息量低（只说明是哪个榜），卡片上不展示 */
const GENERIC_TAGS = new Set([
  '热搜', '热榜', '百度热搜', '微博热搜', '知乎热榜', '头条热榜', '抖音热点', '腾讯新闻',
]);

/**
 * 卡片副标题行「频道 · 作者」，两项都可点：频道 → 频道页，作者 → 作者页。
 * 作者优先用作者实体（有 slug 才能链）；只有字符串作者时退化为纯文字；都没有则只显示频道。
 * 必须放在 stretched-link 卡片里用：链接靠 relative z-10 浮在整卡标题链接之上。
 */
export function CardMeta({ article, className = '' }: { article: ArticleListItem; className?: string }) {
  const ch = article.channel;
  const ref = article.authorRef;
  const authorName = (ref?.name ?? article.author ?? '').trim();
  const link = 'relative z-10 hover:text-brand hover:underline';
  return (
    <p className={`text-xs text-gray-500 ${className}`}>
      {ch?.slug ? (
        <Link href={`/${ch.slug}`} className={link}>
          {ch.name}
        </Link>
      ) : null}
      {ch?.slug && authorName ? <span className="mx-1">·</span> : null}
      {authorName && ref?.slug ? (
        <Link href={`/author/${ref.slug}`} className={link}>
          {authorName}
        </Link>
      ) : (
        authorName
      )}
    </p>
  );
}

/** 卡片标签胶囊行（最多 CARD_TAG_LIMIT 个，链到标签页）；没有可展示的标签时不渲染 */
export function CardTagRow({ article }: { article: ArticleListItem }) {
  const tags = cardTags(article);
  if (tags.length === 0) return null;
  return (
    <div className="relative z-10 mt-1.5 flex gap-1.5 overflow-hidden">
      {tags.map((t) => (
        <Link
          key={t.slug}
          href={`/tag/${t.slug}`}
          className="shrink-0 rounded-full bg-brand/10 px-2 py-0.5 text-xs leading-4 text-brand hover:bg-brand hover:text-white"
        >
          {t.name}
        </Link>
      ))}
    </div>
  );
}

function cardTags(a: ArticleListItem): Array<{ name: string; slug: string }> {
  const sources = new Set((a.source ?? '').split('/').map((s) => s.trim()));
  return (a.tags ?? [])
    .filter((t) => t.slug && !GENERIC_TAGS.has(t.name) && !sources.has(t.name))
    .slice(0, CARD_TAG_LIMIT);
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
  showTags = true,
}: {
  article: ArticleListItem;
  variant: BlockVariant;
  priority?: boolean;
  headingLevel?: 2 | 3;
  /** 仅 left-text-right-image 生效：频道·作者行下加红底胶囊标签。全站默认开；数据需 populate tags（lib/strapi 的 CARD_TAGS_POPULATE），没带标签数据时自动不显示 */
  showTags?: boolean;
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
            <Heading className="line-clamp-1 text-base font-medium leading-snug text-gray-900">
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
          {/* 内边距放外层：line-clamp 按 padding-box 裁切，py 留在标题上会露出第 3 行的上半截 */}
          <div className="px-2 py-2">
            <Heading className="line-clamp-2 text-[15px] font-semibold leading-snug text-gray-900">
              {article.title}
            </Heading>
          </div>
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
          <Heading className="mt-1.5 line-clamp-2 text-sm leading-snug text-gray-900">{article.title}</Heading>
        </article>
      </Link>
    );
  }

  // left-text-right-image（默认）
  // 频道、作者、标签都各自是链接，不能再套在整卡 <Link> 里（<a> 不可嵌套）：
  // 标题链接 after:inset-0 撑满整卡（stretched link），其余链接 relative z-10 浮在其上单独可点
  return (
    <article className="relative flex items-stretch gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <Heading className="line-clamp-2 text-base font-semibold leading-snug text-gray-900">
          <Link href={href(article)} className="after:absolute after:inset-0">
            {article.title}
          </Link>
        </Heading>
        <CardMeta article={article} className="mt-2" />
        {showTags ? <CardTagRow article={article} /> : null}
      </div>
      <div className="relative aspect-[4/3] w-28 shrink-0 overflow-hidden rounded">
        <Cover a={article} sizes="112px" />
      </div>
    </article>
  );
}
