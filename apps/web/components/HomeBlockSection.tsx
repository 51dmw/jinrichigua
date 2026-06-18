import Link from 'next/link';
import type { HomeBlock } from 'shared';
import { ArticleCard } from './ArticleCard';

/** 首页单个模块区块。区块顺序/variant 由后台数据驱动（§5）。 */
export function HomeBlockSection({ block, first }: { block: HomeBlock; first?: boolean }) {
  const [lead, ...rest] = block.items;

  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center justify-between px-1">
        <h2 className="border-l-4 border-brand pl-2 text-base font-bold text-gray-900">
          {block.title}
        </h2>
        {block.channelSlug ? (
          <Link href={`/${block.channelSlug}`} className="text-xs text-gray-400">
            更多 ›
          </Link>
        ) : null}
      </div>

      {/* hero：大图 lead + 列表 */}
      {block.variant === 'hero' ? (
        <div className="space-y-1">
          {lead ? <ArticleCard article={lead} variant="hero" priority={first} /> : null}
          {rest.length ? (
            <div className="divide-y divide-gray-100 rounded-lg bg-white px-3">
              {rest.map((a) => (
                <ArticleCard key={a.documentId} article={a} variant="left-text-right-image" />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* image-top：两列「上图下标题」网格（要闻等重点区块） */}
      {block.variant === 'image-top' ? (
        <div className="grid grid-cols-2 gap-2">
          {block.items.map((a, i) => (
            <ArticleCard key={a.documentId} article={a} variant="image-top" priority={first && i < 2} />
          ))}
        </div>
      ) : null}

      {/* three-image：三列图上文下网格 */}
      {block.variant === 'three-image' ? (
        <div className="grid grid-cols-3 gap-2 rounded-lg bg-white p-3">
          {block.items.slice(0, 6).map((a) => (
            <ArticleCard key={a.documentId} article={a} variant="three-image" />
          ))}
        </div>
      ) : null}

      {/* left-text-right-image / text-only：竖向列表 */}
      {block.variant === 'left-text-right-image' || block.variant === 'text-only' ? (
        <div className="divide-y divide-gray-100 rounded-lg bg-white px-3">
          {block.items.map((a) => (
            <ArticleCard key={a.documentId} article={a} variant={block.variant} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
