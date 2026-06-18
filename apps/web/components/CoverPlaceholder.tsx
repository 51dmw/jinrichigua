/**
 * 文章无封面时的品牌占位图（替换灰底「无图」）。
 * 浅品牌底 + 西瓜切片标 + 字标；object-cover 适配各比例容器，随尺寸缩放。
 */
export function CoverPlaceholder({ wordmark = true }: { wordmark?: boolean }) {
  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-1 bg-[#faf2f2]"
      aria-hidden="true"
    >
      <svg viewBox="0 0 40 24" className="w-[36%] max-w-[72px]">
        <g transform="translate(20,4)">
          <path d="M -15 0 L 15 0 A 15 15 0 0 1 -15 0 Z" fill="#e8484d" />
          <path d="M 15 0 A 15 15 0 0 1 -15 0" fill="none" stroke="#3f9d4f" strokeWidth="3" />
          <ellipse cx="-7" cy="6" rx="1.4" ry="2.2" fill="#3a2a1a" />
          <ellipse cx="0" cy="8.6" rx="1.4" ry="2.2" fill="#3a2a1a" />
          <ellipse cx="7" cy="6" rx="1.4" ry="2.2" fill="#3a2a1a" />
        </g>
      </svg>
      {wordmark ? (
        <span className="px-1 text-center text-[10px] font-medium leading-none text-[#c98f8f]">
          今日吃瓜
        </span>
      ) : null}
    </div>
  );
}
