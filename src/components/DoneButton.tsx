"use client";

import { useEffect, useState } from "react";
import { setDoneEvents } from "@/domain/commands";
import type { TaskInstance } from "@/domain/types";
import { useEngine } from "@/store/react";

/**
 * 「終わった」の印（決定記録 0010）。担当の人かリーダーが 1 タップで付け外しする。元に戻すで戻る。
 * - 時刻が過ぎただけでは付かない。誰が付けたかは画面に出さない。
 * - 休憩・中止には出さない。
 */
export interface DoneNotice {
  label: string;
  batchId: string;
}

/** 押したあとの知らせ（画面のトーストが受ける） */
export const DONE_EVENT = "cn-done";

export function DoneButton({ task, size = "md" }: { task: TaskInstance; size?: "sm" | "md" }) {
  const engine = useEngine();
  if (!engine || task.kind === "break" || task.status === "cancelled") return null;
  const done = Boolean(task.done);
  const label = done ? `「${task.name}」の「終わった」を外しました` : `「${task.name}」を終わったにしました`;
  return (
    <button
      type="button"
      aria-pressed={done}
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const evs = setDoneEvents(task.id, !done, engine.context());
        await engine.dispatch(evs, label);
        window.dispatchEvent(new CustomEvent<DoneNotice>(DONE_EVENT, { detail: { label, batchId: evs[0].batchId } }));
      }}
      className={`inline-flex shrink-0 items-center justify-center gap-1 rounded-lg border font-bold ${
        size === "sm" ? "h-[44px] min-w-[44px] px-2 text-[14px]" : "h-[44px] px-3 text-[15px]"
      } ${done ? "border-[var(--cn-accent)] bg-[var(--cn-accent-soft)] text-[var(--cn-accent)]" : "border-[var(--cn-control-line)] bg-white text-[var(--cn-ink)]"}`}
    >
      {/* 押す前は空の四角（○ は「できた」の印と読まれやすい）。状態は aria-pressed と文字でも伝える */}
      <span aria-hidden="true">{done ? "✓" : "□"}</span>
      {done ? "終わった" : size === "sm" ? "終わった" : "終わったら押す"}
    </button>
  );
}

/**
 * 「終わった」を押したあとの一言と「元に戻す」（スマホの画面下）。
 * 全体の画面は自分のトーストで受けるので、これは自分の予定・業務詳細で使う。
 */
export function DoneToast() {
  const engine = useEngine();
  const [toast, setToast] = useState<DoneNotice | null>(null);
  useEffect(() => {
    const onDone = (e: Event) => setToast((e as CustomEvent<DoneNotice>).detail);
    window.addEventListener(DONE_EVENT, onDone);
    return () => window.removeEventListener(DONE_EVENT, onDone);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 10000);
    return () => window.clearTimeout(id);
  }, [toast]);
  return (
    <div role="status" aria-live="polite" className="cn-noprint fixed inset-x-0 bottom-0 z-20 mx-auto max-w-[480px] px-3 pb-3">
      {toast && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--cn-border)] bg-white px-4 py-2 shadow-lg">
          <span className="min-w-0 text-[15px]">{toast.label}</span>
          <button
            type="button"
            className="h-[44px] shrink-0 rounded-lg border border-[var(--cn-control-line)] px-3 text-[15px] font-bold text-[var(--cn-accent)]"
            onClick={async () => {
              await engine?.undo(toast.batchId);
              setToast(null);
            }}
          >
            元に戻す
          </button>
        </div>
      )}
    </div>
  );
}
