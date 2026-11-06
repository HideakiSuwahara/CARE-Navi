"use client";

import { useEffect, useState } from "react";
import { canMarkDone } from "@/domain/checks";
import { setDoneEvents } from "@/domain/commands";
import type { TaskInstance } from "@/domain/types";
import { useEngine } from "@/store/react";

export interface DoneNotice {
  label: string;
  /** 元に戻せるバッチ。元に戻したあとの知らせは null */
  batchId: string | null;
  taskId: string;
}

/** 押したあとの知らせ（画面のトーストが受ける） */
export const DONE_EVENT = "cn-done";

/**
 * 「終わった」の印（決定記録 0010）。担当の人かリーダーが 1 タップで付け外しする。元に戻すで戻る。
 * - 押す前「□ 終わったら押す」、押した後「✓ 終わった」。状態は aria-pressed でも伝える。名前はどの画面でも同じ。
 * - 時刻が過ぎただけでは付かない。誰が付けたかは画面に出さない。
 * - 休憩・中止・見守りには出さない（見守りは終わる業務ではなく交代する業務）。
 */
export function DoneButton({ task, size = "md" }: { task: TaskInstance; size?: "sm" | "md" }) {
  const engine = useEngine();
  if (!engine || !canMarkDone(task)) return null;
  const done = Boolean(task.done);
  const label = done ? `「${task.name}」の「終わった」を外しました` : `「${task.name}」に「終わった」の印を付けました`;
  return (
    <button
      type="button"
      aria-pressed={done}
      data-done-task={task.id}
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const el = e.currentTarget;
        const evs = setDoneEvents(task.id, !done, engine.context());
        await engine.dispatch(evs, label);
        // 画面下のトーストに隠れる位置なら、押した行を真ん中へ寄せる（✓ と薄さが見えるように）
        const rect = el.getBoundingClientRect();
        if (rect.bottom > window.innerHeight - 150) {
          const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
        }
        window.dispatchEvent(new CustomEvent<DoneNotice>(DONE_EVENT, { detail: { label, batchId: evs[0].batchId, taskId: task.id } }));
      }}
      className={`inline-flex h-[44px] shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-lg border text-[16px] font-bold ${
        size === "sm" ? "px-2" : "px-3"
      } ${done ? "border-[var(--cn-accent)] bg-[var(--cn-accent-soft)] text-[var(--cn-accent)]" : "border-[var(--cn-control-line)] bg-white text-[var(--cn-ink)]"}`}
    >
      {/* 押す前は空の四角（○ は「できた」の印と読まれやすい） */}
      <span aria-hidden="true">{done ? "✓" : "□"}</span>
      {done ? "終わった" : "終わったら押す"}
    </button>
  );
}

/** ボタンの下に添える一言（一緒に入る人がいる枠・対象が複数の枠では、その分も含めて押すと分かるように） */
export function doneHint(task: TaskInstance, togetherCount: number): string {
  if (task.done) return "「終わった」の印が付いています";
  if (togetherCount > 0) return "一緒に入る人の分も終わったら押します（元に戻せます）";
  if (task.targetMode === "group") return "対象の方 全員が終わったら押します（元に戻せます）";
  return "終わったら印を付けます（元に戻せます）";
}

/**
 * 「終わった」を押したあとの一言と「元に戻す」（スマホの画面下）。
 * 全体の画面は自分のトーストで受けるので、これは自分の予定・業務詳細で使う。
 * raised: 画面下に［自分｜全体］があるとき、その上に出す。
 */
export function DoneToast({ raised = false }: { raised?: boolean }) {
  const engine = useEngine();
  const [toast, setToast] = useState<DoneNotice | null>(null);
  useEffect(() => {
    const onDone = (e: Event) => setToast((e as CustomEvent<DoneNotice>).detail);
    window.addEventListener(DONE_EVENT, onDone);
    return () => window.removeEventListener(DONE_EVENT, onDone);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), toast.batchId ? 10000 : 6000);
    return () => window.clearTimeout(id);
  }, [toast]);
  return (
    <div role="status" aria-live="polite" className={`cn-noprint fixed inset-x-0 z-40 mx-auto max-w-[480px] px-3 pb-3 ${raised ? "bottom-[72px]" : "bottom-0"}`}>
      {toast && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--cn-border)] bg-white px-4 py-2 shadow-lg">
          <span className="min-w-0 text-[16px]">{toast.label}</span>
          {toast.batchId && (
            <button
              type="button"
              className="h-[44px] shrink-0 rounded-lg border border-[var(--cn-control-line)] px-3 text-[16px] font-bold text-[var(--cn-accent)]"
              onClick={async () => {
                await engine?.undo(toast.batchId!);
                // 戻したことを一言。フォーカスは押したボタンへ返す
                setToast({ label: `元に戻しました（取り消した操作: ${toast.label}）`, batchId: null, taskId: toast.taskId });
                if (toast.taskId) document.querySelector<HTMLElement>(`[data-done-task="${CSS.escape(toast.taskId)}"]`)?.focus();
              }}
            >
              元に戻す
            </button>
          )}
        </div>
      )}
    </div>
  );
}
