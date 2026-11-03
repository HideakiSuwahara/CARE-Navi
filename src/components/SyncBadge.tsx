"use client";

import Link from "next/link";
import { useSyncStatus } from "@/store/react";

/**
 * 見出しの同期の印（docs/screens.md §0.8）。ブラウザ内保存のときは何も出さない。
 * 同期中 ／ この端末の内容（未送信 n 件） ／ つないでいます。押すと設定の施設コードへ。
 */
export function SyncBadge({ offlineOnly = false }: { offlineOnly?: boolean }) {
  const { kind, status, pending } = useSyncStatus();
  if (kind !== "sync") return null;
  if (offlineOnly && status === "online") return null;
  const label = status === "online" ? "同期中" : status === "offline" ? `この端末の内容${pending > 0 ? `（未送信 ${pending} 件）` : ""}` : "つないでいます";
  const sr = status === "online" ? "（ほかの端末と同じ内容です）" : status === "offline" ? "（同期先に届いていません）" : "";
  const tone = status === "online" ? "border-[var(--cn-accent)] text-[var(--cn-accent)]" : "border-[var(--cn-alert-line)] text-[var(--cn-unassigned-ink)]";
  return (
    <Link href="/setup" role="status" className={`inline-flex h-[28px] items-center rounded-md border px-2 text-[14px] font-bold ${tone}`}>
      {label}
      <span className="sr-only">{sr}</span>
    </Link>
  );
}
