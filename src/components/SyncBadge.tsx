"use client";

import { useSyncStatus } from "@/store/react";

/**
 * 見出しの同期の印（docs/screens.md §0.8）。ブラウザ内保存のときは何も出さない。
 * 同期中 ／ この端末の内容（届かないとき） ／ 接続中
 */
export function SyncBadge() {
  const { kind, status } = useSyncStatus();
  if (kind !== "sync") return null;
  const label = status === "online" ? "同期中" : status === "offline" ? "この端末の内容" : "接続中";
  const tone = status === "online" ? "border-[var(--cn-accent)] text-[var(--cn-accent)]" : "border-[var(--cn-alert-line)] text-[var(--cn-unassigned-ink)]";
  return (
    <span role="status" className={`inline-flex h-[28px] items-center rounded-md border px-2 text-[14px] font-bold ${tone}`}>
      {label}
    </span>
  );
}
