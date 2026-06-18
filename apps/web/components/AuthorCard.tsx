import Image from 'next/image';
import Link from 'next/link';
import type { Author } from 'shared';
import { mediaUrl, imageAlt } from '@/lib/strapi';

type A = Pick<Author, 'name' | 'slug' | 'role' | 'bio' | 'avatar'>;

/** 文章作者署名卡（E-E-A-T：头像 + 姓名 + 头衔 + 简介 + 作者页入口）。 */
export function AuthorCard({ author }: { author: A }) {
  const avatar = mediaUrl(author.avatar);
  return (
    <div className="mt-5 flex items-center gap-3 rounded-lg bg-gray-50 p-3">
      <Link href={`/author/${author.slug}`} className="shrink-0">
        {avatar ? (
          <Image
            src={avatar}
            alt={imageAlt(author.avatar, `${author.name}${author.role ? `，${author.role}` : ''}的头像`)}
            width={48}
            height={48}
            className="h-12 w-12 rounded-full object-cover"
          />
        ) : (
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand text-lg font-medium text-white">
            {author.name.slice(0, 1)}
          </span>
        )}
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Link
            href={`/author/${author.slug}`}
            className="font-medium text-gray-800 hover:text-brand"
          >
            {author.name}
          </Link>
          {author.role ? (
            <span className="rounded bg-white px-1.5 py-0.5 text-[10px] text-gray-500">
              {author.role}
            </span>
          ) : null}
        </div>
        {author.bio ? <p className="mt-0.5 line-clamp-2 text-xs text-gray-500">{author.bio}</p> : null}
      </div>
      <Link href={`/author/${author.slug}`} className="shrink-0 text-xs text-brand hover:underline">
        TA 的文章 ›
      </Link>
    </div>
  );
}
