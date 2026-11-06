/**
 * ケアナビのロゴ（決定記録 0019）。時間割の格子に、人の付いた 1 つの枠。紺 1 色＋白。
 * 飾りなので読み上げない（名前は隣の文字「ケアナビ」）。
 */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true" focusable="false" className="shrink-0">
      <rect x="0" y="0" width="28" height="28" rx="7" fill="var(--cn-accent)" />
      {/* 時間割の格子 */}
      <path d="M6 10.5h16M6 16h16M6 21.5h16M11.5 6v16M17 6v16" stroke="#ffffff" strokeOpacity="0.35" strokeWidth="1.2" />
      {/* 人の付いた枠 */}
      <rect x="11.5" y="10.5" width="5.5" height="5.5" rx="1.2" fill="#ffffff" />
      <circle cx="14.25" cy="12.4" r="1.1" fill="var(--cn-accent)" />
      <path d="M12.6 15.2c0.4-1 1-1.4 1.65-1.4s1.25 0.4 1.65 1.4" stroke="var(--cn-accent)" strokeWidth="1" fill="none" strokeLinecap="round" />
    </svg>
  );
}
