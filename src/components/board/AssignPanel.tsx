"use client";

import { useEffect, useRef, useState } from "react";
import { headcountStatus, rankCandidates, splitCandidates, type Candidate } from "@/domain/checks";
import { assignEvents } from "@/domain/commands";
import { fmtRange } from "@/domain/time";
import type { ID, State } from "@/domain/types";
import type { Engine } from "@/store/engine";

/**
 * 担当の追加（docs/screens.md §0.5）。カードの「＋」で右に開く。
 * - 「問題なし」の人だけを開いて出す（名字・番・理由一文・「追加」）
 * - その下に「ほかの人（注意 n・勤務外 n）」を1行。押すと開く。注意の人は理由つきで追加できる。勤務外・休みの人は「追加」を出さない
 * - 「追加」1回で決まる（確認なし）。結果はトーストと「元に戻す」
 * 満たしたら閉じる。まだ足りないときは開いたまま（続けて追加できる）。
 */
export function AssignPanel({
  state,
  engine,
  taskId,
  onClose,
  onDetail,
}: {
  state: State;
  engine: Engine | null;
  taskId: ID;
  onClose: () => void;
  onDetail?: (taskId: ID) => void;
}) {
  const task = state.tasks[taskId];
  // 「空いている人」が 0 人なら、ほかの人を最初から開いておく（押す回数を増やさない）
  const [showOthers, setShowOthers] = useState(() => splitCandidates(rankCandidates(state, taskId)).open.length === 0);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!task) return null;
  const status = headcountStatus(state, task.id);
  const isBreak = task.kind === "break";
  const short = !isBreak && (status.level === "unassigned" || status.level === "short");
  const { open, folded, warnCount, offCount } = splitCandidates(rankCandidates(state, task.id));

  const add = async (c: Candidate) => {
    if (!engine) return;
    const before = headcountStatus(engine.state, task.id);
    await engine.dispatch(assignEvents(task.id, c.staff.id, engine.context()), `${c.staff.surname}さんを「${task.name}」の担当にしました`);
    const after = headcountStatus(engine.state, task.id);
    // 満たした（または元から満たしていた）ら閉じる
    if (after.level === "ok" || after.level === "over" || (before.level !== "unassigned" && before.level !== "short")) onClose();
  };

  const slotName = (c: Candidate) => (c.entry?.slotId ? state.roleSlots[c.entry.slotId]?.name : undefined);

  const row = (c: Candidate, canAdd: boolean) => {
    const reason = c.issues[0]?.message ?? (c.sameSlot ? "この業務の番です" : "この時間は空いています");
    return (
      <li key={c.staff.id} className="flex items-center gap-3 px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-bold">{c.staff.surname}</span>
            {slotName(c) && <span className="text-[14px] text-[var(--cn-ink-soft)]">{slotName(c)}</span>}
            {c.entry?.firstTimer && <span className="rounded border border-[var(--cn-card-line)] px-1 text-[12px]">初回</span>}
          </div>
          <p className="text-[14px] text-[var(--cn-ink-soft)]">
            {c.tier === "warn" && <span className="font-bold text-[var(--cn-short-ink)]">注意: </span>}
            {reason}
          </p>
        </div>
        {canAdd && (
          <button
            type="button"
            onClick={() => add(c)}
            aria-label={`${c.staff.surname}さんを追加`}
            className={`h-[44px] shrink-0 rounded-lg px-4 text-[15px] font-bold ${
              c.tier === "ok" ? "bg-[var(--cn-accent)] text-white" : "border border-[var(--cn-control-line)] bg-white"
            }`}
          >
            追加
          </button>
        )}
      </li>
    );
  };

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-labelledby="assign-title"
      className="fixed inset-y-0 right-0 z-40 flex w-[420px] max-w-full flex-col border-l border-[var(--cn-border)] bg-white shadow-[-8px_0_24px_rgba(0,0,0,0.08)]"
    >
      <div className="flex items-start gap-3 border-b border-[var(--cn-border)] p-4">
        <div className="min-w-0 flex-1">
          <p className="text-[14px] text-[var(--cn-muted)]">担当を追加</p>
          <h2 id="assign-title" className="text-[18px] font-bold">
            {task.name}
          </h2>
          <p className="flex flex-wrap items-center gap-2 text-[15px] text-[var(--cn-ink-soft)]">
            {fmtRange(task.startMin, task.endMin)}
            {short && (
              <span
                className={`inline-flex h-[28px] items-center rounded-md px-2 text-[14px] font-bold ${
                  status.level === "unassigned" ? "bg-[var(--cn-unassigned-bg)] text-[var(--cn-unassigned-ink)]" : "bg-[var(--cn-short-bg)] text-[var(--cn-short-ink)]"
                }`}
              >
                {status.label}
              </span>
            )}
          </p>
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="閉じる"
          className="inline-flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-lg bg-[var(--cn-ground)] text-[20px]"
        >
          ×
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-auto p-4">
        <section aria-labelledby="ok-title">
          <h3 id="ok-title" className="mb-1.5 text-[14px] font-bold text-[var(--cn-muted)]">
            空いている人 {open.length}人
          </h3>
          {open.length > 0 ? (
            <ul className="divide-y divide-[var(--cn-grid)] rounded-xl border border-[var(--cn-border)]">{open.map((c) => row(c, true))}</ul>
          ) : (
            <p className="rounded-xl bg-[var(--cn-ground)] p-3 text-[15px]">この時間に空いている人はいません。下の「ほかの人」から選べます。</p>
          )}
        </section>

        {folded.length > 0 && (
          <section>
            <button
              type="button"
              aria-expanded={showOthers}
              onClick={() => setShowOthers((v) => !v)}
              className="flex h-[44px] w-full items-center justify-between rounded-lg border border-[var(--cn-control-line)] px-3 text-left text-[15px]"
            >
              <span>
                ほかの人（注意 {warnCount}・勤務外 {offCount}）
              </span>
              <span aria-hidden="true">{showOthers ? "▴" : "▾"}</span>
            </button>
            {showOthers && (
              <ul className="mt-2 divide-y divide-[var(--cn-grid)] rounded-xl border border-[var(--cn-border)]">
                {folded.map((c) => row(c, c.tier === "warn"))}
              </ul>
            )}
          </section>
        )}

        {onDetail && (
          <button type="button" onClick={() => onDetail(task.id)} className="h-[44px] self-start text-[15px] text-[var(--cn-accent)] underline">
            この業務の詳細を見る
          </button>
        )}
      </div>
    </aside>
  );
}
