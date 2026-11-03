"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useAppState } from "@/store/react";

export type TopBarPage = "board" | "residents" | "review" | "setup";

const NAV: { id: TopBarPage; href: string; label: string }[] = [
  { id: "board", href: "/board", label: "ボード" },
  { id: "residents", href: "/residents", label: "利用者" },
  { id: "review", href: "/review", label: "業務の見直し" },
  { id: "setup", href: "/setup", label: "設定" },
];

/** PC の上部バー（1段）。施設名・主な画面のナビ・右側の情報 */
export function TopBar({ current, children }: { current: TopBarPage; children?: ReactNode }) {
  const { state } = useAppState();
  return (
    <header className="cn-noprint flex min-h-[56px] shrink-0 flex-wrap items-center gap-x-5 gap-y-1 border-b border-[var(--cn-border)] bg-white px-4 py-1 sm:px-5">
      <h1 className="flex shrink-0 items-center gap-2.5 whitespace-nowrap">
        <span aria-hidden="true" className="inline-block h-7 w-7 rounded-lg bg-[var(--cn-accent)]" />
        <span className="text-[18px] font-bold">ケアナビ</span>
        <span className="hidden text-[14px] font-normal text-[var(--cn-muted)] sm:inline">{state.facility?.name ?? ""}</span>
      </h1>
      <nav aria-label="主な画面" className="flex gap-1 overflow-x-auto whitespace-nowrap">
        {NAV.map((n) =>
          n.id === current ? (
            <Link
              key={n.id}
              href={n.href}
              aria-current="page"
              className="inline-flex min-h-[44px] items-center rounded-lg bg-[var(--cn-accent-soft)] px-3.5 font-bold text-[var(--cn-accent)]"
            >
              {n.label}
            </Link>
          ) : (
            <Link key={n.id} href={n.href} className="inline-flex min-h-[44px] items-center rounded-lg px-3.5 text-[var(--cn-ink-soft)]">
              {n.label}
            </Link>
          ),
        )}
      </nav>
      {children && <div className="ml-auto flex items-center gap-4">{children}</div>}
    </header>
  );
}
