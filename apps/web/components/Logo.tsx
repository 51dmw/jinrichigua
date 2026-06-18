/**
 * 品牌 Logo：西瓜切片标 + 字标（今日吃瓜）。
 * variant='white' 用于红底头部；'color' 用于浅底（页脚等）。
 */
export function Logo({
  name = '今日吃瓜',
  variant = 'white',
  className = '',
}: {
  name?: string;
  variant?: 'white' | 'color';
  className?: string;
}) {
  const white = variant === 'white';
  const flesh = white ? '#ffffff' : '#e8484d';
  const seed = white ? '#c1272d' : '#3a2a1a';
  const text = white ? '#ffffff' : '#c1272d';
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <svg viewBox="0 0 36 26" className="h-7 w-9 shrink-0" aria-hidden="true">
        <g transform="translate(18,5)">
          <path d="M -15 0 L 15 0 A 15 15 0 0 1 -15 0 Z" fill={flesh} />
          {!white ? (
            <path d="M 15 0 A 15 15 0 0 1 -15 0" fill="none" stroke="#3f9d4f" strokeWidth="3" />
          ) : null}
          <ellipse cx="-7" cy="6" rx="1.4" ry="2" fill={seed} />
          <ellipse cx="0" cy="8.6" rx="1.4" ry="2" fill={seed} />
          <ellipse cx="7" cy="6" rx="1.4" ry="2" fill={seed} />
        </g>
      </svg>
      <span className="text-lg font-bold leading-none" style={{ color: text }}>
        {name}
      </span>
    </span>
  );
}
