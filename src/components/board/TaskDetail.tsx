"use client";

import { useEffect, useRef } from "react";
import { assigneesOf, headcountStatus } from "@/domain/checks";
import { cancelTaskEvents, shiftTaskEvents, unassignEvents } from "@/domain/commands";
import { sheetRowFor } from "@/domain/routine";
import { clockLabel, fmtRange } from "@/domain/time";
import type { ID, State } from "@/domain/types";
import type { Engine } from "@/store/engine";

/**
 * 業務の詳細（ボードでカードの名前を押すと右に開く）。
 * - 対象の方ごとに、時刻（枠の中で時刻が違う方はその時刻）と、24時間シートの「サポートが必要なこと」を1行（決定記録 0004 §4）
 * - お願いすること／しないこと・手順・物品・相談先は業務の種類から
 * ボード（施設の PC）なので利用者はフルネームで出す。手元画面（自分の予定）は表示名の設定に従う（D3）。
 */
export function TaskDetail({
  state,
  engine,
  taskId,
  onClose,
  onAdd,
}: {
  state: State;
  engine?: Engine | null;
  taskId: ID;
  onClose: () => void;
  onAdd?: (taskId: ID) => void;
}) {
  const task = state.tasks[taskId];
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
  const assignees = assigneesOf(state, task.id);
  const targets = (state.targets[task.id] ?? []).map((rid) => state.residents[rid]).filter(Boolean);
  const group = task.groupId ? state.groups[task.groupId] : undefined;
  const isBreak = task.kind === "break";
  const short = !isBreak && (status.level === "unassigned" || status.level === "short");

  const unassign = (staffId: ID, surname: string) => {
    if (!engine) return;
    engine.dispatch(unassignEvents(engine.state, task.id, staffId, engine.context()), `${surname}さんを「${task.name}」の担当から外しました`);
  };
  const shift = (delta: number) => {
    if (!engine) return;
    const word = `${Math.abs(delta)}分${delta > 0 ? "後へ" : "前へ"}`;
    engine.dispatch(shiftTaskEvents(engine.state, task.id, delta, engine.context()), `「${task.name}」を${word}ずらしました`);
  };
  const cancel = () => {
    if (!engine) return;
    engine.dispatch(cancelTaskEvents(task.id, engine.context()), `「${task.name}」を中止にしました`);
    onClose();
  };

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-labelledby="task-detail-title"
      className="fixed inset-y-0 right-0 z-40 flex w-[460px] max-w-full flex-col border-l border-[var(--cn-border)] bg-white shadow-[-8px_0_24px_rgba(0,0,0,0.08)]"
    >
      <div className="flex items-start gap-3 border-b border-[var(--cn-border)] p-4">
        <div className="min-w-0 flex-1">
          <h2 id="task-detail-title" className="text-[18px] font-bold">
            {task.name}
          </h2>
          <p className="text-[15px] text-[var(--cn-ink-soft)]">
            {fmtRange(task.startMin, task.endMin)}
            {group && group.kind !== "common" && ` ・ ${group.name}`}
            {task.place && ` ・ ${task.place}`}
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

      <div className="flex flex-1 flex-col gap-4 overflow-auto p-4">
        <section aria-labelledby="d-staff">
          <h3 id="d-staff" className="mb-1.5 text-[14px] font-bold text-[var(--cn-muted)]">
            担当
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            {assignees.map((s) => (
              <span key={s.id} className="inline-flex h-[44px] items-center gap-1 rounded-full border border-[var(--cn-accent)] bg-[var(--cn-accent-soft)] pl-3 text-[15px] text-[var(--cn-accent)]">
                {s.surname}
                {engine && (
                  <button
                    type="button"
                    onClick={() => unassign(s.id, s.surname)}
                    aria-label={`${s.surname}さんを担当から外す`}
                    className="inline-flex h-[44px] w-[40px] items-center justify-center rounded-full text-[17px]"
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
            {assignees.length === 0 && <span className="text-[15px] text-[var(--cn-ink-soft)]">まだいません</span>}
            {short && (
              <span
                className={`inline-flex h-[32px] items-center rounded-md px-2.5 text-[14px] font-bold ${
                  status.level === "unassigned" ? "bg-[var(--cn-unassigned-bg)] text-[var(--cn-unassigned-ink)]" : "bg-[var(--cn-short-bg)] text-[var(--cn-short-ink)]"
                }`}
              >
                {status.label}
              </span>
            )}
            {onAdd && (
              <button type="button" onClick={() => onAdd(task.id)} className="h-[44px] rounded-lg border border-dashed border-[var(--cn-muted)] px-3 text-[15px]">
                ＋ 担当を追加
              </button>
            )}
          </div>
        </section>

        {engine && (
          <section aria-labelledby="d-ops" className="flex flex-wrap items-center gap-2">
            <h3 id="d-ops" className="sr-only">
              時刻と中止
            </h3>
            <button type="button" onClick={() => shift(-30)} className="h-[44px] rounded-lg border border-[var(--cn-control-line)] px-3 text-[15px]">
              30分前へ
            </button>
            <button type="button" onClick={() => shift(30)} className="h-[44px] rounded-lg border border-[var(--cn-control-line)] px-3 text-[15px]">
              30分後へ
            </button>
            {!isBreak && (
              <button type="button" onClick={cancel} className="ml-auto h-[44px] rounded-lg border border-[var(--cn-control-line)] px-3 text-[15px]">
                この業務を中止
              </button>
            )}
          </section>
        )}

        {(task.scopeNote || task.outOfScopeNote) && (
          <section className="rounded-xl border-2 border-[var(--cn-accent)] p-3">
            {task.scopeNote && (
              <>
                <h3 className="text-[14px] font-bold text-[var(--cn-accent)]">お願いすること</h3>
                <p className="text-[15px]">{task.scopeNote}</p>
              </>
            )}
            {task.outOfScopeNote && (
              <>
                <h3 className="mt-2 text-[14px] font-bold text-[var(--cn-ink-soft)]">お願いしないこと</h3>
                <p className="text-[15px]">{task.outOfScopeNote}</p>
              </>
            )}
          </section>
        )}

        {targets.length > 0 && (
          <section aria-labelledby="d-targets">
            <h3 id="d-targets" className="mb-1.5 text-[14px] font-bold text-[var(--cn-muted)]">
              対象の方 {targets.length}人
            </h3>
            <ul className="flex flex-col divide-y divide-[var(--cn-grid)] rounded-xl border border-[var(--cn-border)]">
              {targets.map((r) => {
                const changed = task.targetTimes?.[r.id];
                const row = task.routineId ? sheetRowFor(state, r.id, task.routineId) : undefined;
                return (
                  <li key={r.id} className="flex flex-col gap-0.5 px-3 py-2">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[13px] text-[var(--cn-muted)]">{r.room}</span>
                      <span className="font-bold">{r.displayName}様</span>
                      {changed !== undefined && <span className="ml-auto text-[15px] font-bold">{clockLabel(changed)}</span>}
                    </div>
                    {row?.support && <p className="text-[14px] text-[var(--cn-ink-soft)]">サポート: {row.support}</p>}
                  </li>
                );
              })}
            </ul>
            {(Object.keys(task.targetTimes ?? {}).length > 0 || targets.some((r) => task.routineId && sheetRowFor(state, r.id, task.routineId)?.support)) && (
              <p className="mt-1.5 text-[14px] text-[var(--cn-muted)]">右の時刻は、いつもと違う時刻の方です。サポートは24時間シートから出しています。</p>
            )}
          </section>
        )}

        {task.procedure && task.procedure.length > 0 && (
          <section aria-labelledby="d-proc">
            <h3 id="d-proc" className="mb-1.5 text-[14px] font-bold text-[var(--cn-muted)]">
              この施設の手順
            </h3>
            <ol className="list-decimal pl-5 text-[15px]">
              {task.procedure.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ol>
          </section>
        )}
        {task.supplies && (
          <section>
            <h3 className="mb-1 text-[14px] font-bold text-[var(--cn-muted)]">物品の場所</h3>
            <p className="text-[15px]">{task.supplies}</p>
          </section>
        )}
        {task.contact && (
          <section>
            <h3 className="mb-1 text-[14px] font-bold text-[var(--cn-muted)]">困ったら</h3>
            <p className="text-[15px]">{task.contact}</p>
          </section>
        )}
      </div>
    </aside>
  );
}
