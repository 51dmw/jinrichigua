/**
 * 品牌 Logo：纯字标。站名末两字放进色块（「今日」+ 色块「吃瓜」），其余为普通字。
 * 站名不足 3 字时不拆，整体作普通字。
 * variant：'color' 用于白/浅底；'white' 用于品牌红底；'dark' 用于深色底。
 */
const TONES = {
  color: { head: 'text-gray-900', tag: 'bg-brand text-white' },
  white: { head: 'text-white', tag: 'bg-white text-brand' },
  dark: { head: 'text-white', tag: 'bg-brand text-white' },
} as const;

export function Logo({
  name = '今日吃瓜',
  variant = 'color',
  className = '',
}: {
  name?: string;
  variant?: keyof typeof TONES;
  className?: string;
}) {
  const tone = TONES[variant];
  const chars = Array.from(name);
  const split = chars.length >= 3;
  const head = split ? chars.slice(0, -2).join('') : name;
  const tag = split ? chars.slice(-2).join('') : '';
  return (
    <span className={`flex items-center gap-1.5 font-bold leading-none ${className}`}>
      <span className={`text-[22px] tracking-wider ${tone.head}`}>{head}</span>
      {tag ? (
        <span className={`rounded-sm py-1 pl-1.5 pr-1 text-lg tracking-wider ${tone.tag}`}>
          {tag}
        </span>
      ) : null}
    </span>
  );
}
