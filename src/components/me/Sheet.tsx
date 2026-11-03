"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * スマホの下から出るシート。docs/screens.md §0.5
 * 開くと見出しへフォーカス、Esc・「閉じる」で閉じる（フォーカスは呼び出し側が戻す）。
 */
export function Sheet({
  title,
  subtitle,
  badge,
  onClose,
  footer,
  children,
}: {
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const headRef = useRef<HTMLHeadingElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    headRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key !== "Tab" || !boxRef.current) return;
      // フォーカスをシートの中にとどめる（最後の次は最初へ、最初の前は最後へ）
      const items = [...boxRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])")];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === headRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (!boxRef.current.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={boxRef} role="dialog" aria-modal="true" aria-labelledby="sheet-title" className="flex max-h-[92vh] w-full max-w-[480px] flex-col rounded-t-2xl bg-[var(--cn-ground)] text-[16px]">
        <div className="flex items-start gap-3 rounded-t-2xl border-b border-[var(--cn-border)] bg-white px-4 py-3">
          <div className="min-w-0 flex-1">
            {subtitle && <p className="text-[14px] text-[var(--cn-ink-soft)]">{subtitle}</p>}
            <h2 id="sheet-title" ref={headRef} tabIndex={-1} className="text-[18px] font-bold outline-none">
              {title}
            </h2>
            {badge}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="inline-flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-lg border border-[var(--cn-control-line)] bg-white text-[20px]"
          >
            ×
          </button>
        </div>
        <div className="flex flex-1 flex-col gap-4 overflow-auto p-4">{children}</div>
        {footer && <div className="border-t border-[var(--cn-border)] bg-white p-3">{footer}</div>}
      </div>
    </div>
  );
}
