"use client";

import Link from "next/link";
import { meHref } from "./links";

/** リーダーのスマホの画面下［自分｜全体］。docs/screens.md §4.1 */
export function LeaderTabs({ current }: { current: "me" | "all" }) {
  const tab = (key: "me" | "all", label: string) => {
    const on = current === key;
    return (
      <Link
        href={meHref(undefined, key === "all" ? "all" : undefined)}
        aria-current={on ? "page" : undefined}
        className={`flex h-[52px] flex-1 items-center justify-center text-[16px] font-bold ${
          on ? "border-t-4 border-[var(--cn-accent)] bg-[var(--cn-accent-soft)] text-[var(--cn-accent)]" : "border-t-4 border-transparent text-[var(--cn-ink-soft)]"
        }`}
      >
        {label}
        {on && <span className="sr-only">（表示中）</span>}
      </Link>
    );
  };
  return (
    <nav aria-label="自分の予定と全体の切替" className="flex">
      {tab("me", "自分")}
      {tab("all", "全体")}
    </nav>
  );
}
