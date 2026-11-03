"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Event } from "@/domain/events";
import { shortageGroups, splitCandidates, type Candidate } from "@/domain/checks";
import {
  absencePreview,
  assignEvents,
  cancelTaskEvents,
  defaultEscortRange,
  escortPreview,
  ESCORT_NAMES,
  restoreTaskEvents,
  shiftBreakPreview,
  shiftTaskEvents,
  unassignEvents,
  type Preview,
} from "@/domain/commands";
import { updatedAtLabel } from "@/domain/display";
import { absenceChoices, absenceKind, allRows, candidatesForPreview, escortChoices, escortTemplateId, touchedTaskIds, type AllRow } from "@/domain/leader";
import { viewerMinutes } from "@/domain/myday";
import type { EventContext } from "@/domain/pattern";
import { fmtMin, fmtRange } from "@/domain/time";
import type { ID, State } from "@/domain/types";
import type { Engine } from "@/store/engine";
import { useEngine } from "@/store/react";
import { PreviewSheet } from "./PreviewSheet";
import { Sheet } from "./Sheet";

/**
 * 全体（リーダーのスマホ）。docs/screens.md §4.1、決定記録 0004 §8
 * - 上部: 「更新 10:07」と「担当未定 2件」（押すと該当行へ）
 * - 時間順の一覧: 各行に「⋯」（中止・ずらす・担当を外す）、未充足の行に「＋」
 * - 画面下: クイック操作［欠勤・早退｜付き添い・外出］と「元に戻す」
 * - クイック操作は ボタン → 選ぶ → 「この内容で決定」の3タップ。既定値を入れておく
 * - 決定後は一覧に戻り、変わった行を3秒強調する（文字でも「変わりました」）
 */
type SheetState =
  | { kind: "menu"; taskId: ID }
  | { kind: "assign"; taskId: ID }
  | { kind: "escort" }
  | { kind: "absence" }
  | null;

/** 同じ入力なら同じ ID になる文脈（プレビューを作り直しても、チェックの状態が保てる） */
function stableContext(engine: Engine, batchId: ID): EventContext {
  let n = 0;
  return { ...engine.context(batchId), newId: () => `${batchId}-${n++}` };
}

function newBatchId(): ID {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function AllView({ state, date, me, now, clock, tabs }: { state: State; date: string; me: ID; now: number; clock: number; tabs: ReactNode }) {
  void me;
  const engine = useEngine();
  const lastUndo = useSyncExternalStore(
    (cb) => (engine ? engine.subscribe(cb) : () => {}),
    () => engine?.lastUndo ?? null,
    () => null,
  );
  const rows = useMemo(() => allRows(state, date, now), [state, date, now]);
  const groups = useMemo(() => shortageGroups(state, date), [state, date]);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [flash, setFlash] = useState<Set<ID>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
    document.title = "全体 — ケアナビ";
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 8000);
    return () => window.clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (flash.size === 0) return;
    const id = window.setTimeout(() => setFlash(new Set()), 3000);
    return () => window.clearTimeout(id);
  }, [flash]);

  const open = (s: SheetState) => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    setSheet(s);
  };
  const close = useCallback(() => {
    setSheet(null);
    const el = returnFocus.current;
    window.setTimeout(() => {
      if (el && document.contains(el)) el.focus();
      else titleRef.current?.focus();
    }, 0);
  }, []);

  /** 適用して一覧に戻る。変わった行を3秒強調し、トーストで「何をしたか＋元に戻す」 */
  const apply = useCallback(
    async (events: Event[], label: string, keepOpen = false) => {
      if (!engine || events.length === 0) return;
      const touched = touchedTaskIds(engine.state, events);
      await engine.dispatch(events, label);
      setFlash(new Set(touched));
      setToast(label);
      if (!keepOpen) {
        setSheet(null);
        window.setTimeout(() => {
          const first = touched.map((id) => document.querySelector<HTMLElement>(`[data-all-task="${CSS.escape(id)}"]`)).find(Boolean);
          if (first) {
            first.scrollIntoView({ block: "center" });
            first.focus({ preventScroll: true });
          } else titleRef.current?.focus();
        }, 0);
      }
    },
    [engine],
  );

  const undo = async () => {
    if (!engine) return;
    const done = await engine.undo();
    if (done) setToast(`元に戻しました（${done.label}）`);
  };

  const jumpTo = (label: string) => {
    const row = rows.find((r) => r.unfilled && r.status.label === label);
    if (!row) return;
    const el = document.querySelector<HTMLElement>(`[data-all-task="${CSS.escape(row.task.id)}"]`);
    el?.scrollIntoView({ block: "center" });
    el?.focus({ preventScroll: true });
  };

  const [, m, d] = date.split("-").map(Number);
  const wd = "日月火水木金土"[new Date(Date.UTC(Number(date.slice(0, 4)), m - 1, d)).getUTCDay()];
  const updated = updatedAtLabel(state.days[date]?.updatedAt);
  const sheetTask = sheet && (sheet.kind === "menu" || sheet.kind === "assign") ? state.tasks[sheet.taskId] : undefined;

  return (
    <main className="mx-auto min-h-screen max-w-[480px] bg-[var(--cn-ground)] pb-[160px] text-[16px]">
      <style>{"html { scroll-padding-top: 120px; scroll-padding-bottom: 170px; }"}</style>
      <header className="sticky top-0 z-20 border-b border-[var(--cn-border)] bg-white px-4 pb-3 pt-4">
        <div className="flex items-baseline gap-2">
          <h1 ref={titleRef} tabIndex={-1} className="text-[20px] font-bold outline-none">
            全体
          </h1>
          <span className="text-[16px] text-[var(--cn-ink-soft)]">
            {m}/{d}（{wd}）
          </span>
          {updated && <span className="ml-auto text-[14px] text-[var(--cn-muted)]">{updated}</span>}
        </div>
        {groups.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {groups.map((g) => (
              <button
                key={g.label}
                type="button"
                onClick={() => jumpTo(g.label)}
                className={`inline-flex h-[44px] items-center rounded-lg border px-3 text-[16px] font-bold ${
                  g.level === "unassigned"
                    ? "border-dashed border-[var(--cn-alert-line)] bg-[var(--cn-unassigned-bg)] text-[var(--cn-unassigned-ink)]"
                    : "border-[var(--cn-alert-line)] bg-[var(--cn-short-bg)] text-[var(--cn-short-ink)]"
                }`}
              >
                {g.label} {g.count}件<span className="sr-only">（最初の行へ移る）</span>
              </button>
            ))}
          </div>
        ) : (
          rows.length > 0 && <p className="mt-1 text-[16px] text-[var(--cn-ink-soft)]">担当の決まっていない業務はありません。</p>
        )}
      </header>

      {rows.length === 0 ? (
        <section className="m-4 rounded-xl bg-white p-4">
          <p>きょうの時間割はまだできていません。施設の PC のボードで「この内容で作る」を押すと、ここに出ます。</p>
        </section>
      ) : (
        <ol aria-label="きょうの業務（時間順）" className="m-4 flex flex-col overflow-hidden rounded-xl border border-[var(--cn-border)] bg-white">
          {rows.map((r) => (
            <Row key={r.task.id} row={r} flash={flash.has(r.task.id)} onMenu={() => open({ kind: "menu", taskId: r.task.id })} onAdd={() => open({ kind: "assign", taskId: r.task.id })} />
          ))}
        </ol>
      )}

      {/* 画面下（親指の位置）: クイック操作と元に戻す。その下に［自分｜全体］ */}
      <div className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-[480px] border-t border-[var(--cn-control-line)] bg-white">
        <div role="status" aria-live="polite" className="pointer-events-none absolute inset-x-3 bottom-full mb-2">
          {toast && (
            <p className="pointer-events-auto flex items-center gap-2 rounded-xl bg-[var(--cn-ink)] px-3 py-2 text-[15px] text-white shadow-lg">
              <span className="min-w-0 flex-1">{toast}</span>
              {lastUndo && !toast.startsWith("元に戻しました") && (
                <button type="button" onClick={undo} className="h-[44px] shrink-0 rounded-lg border border-white px-3 font-bold">
                  元に戻す
                </button>
              )}
            </p>
          )}
        </div>
        <div className="flex gap-2 px-3 pt-2">
          <button type="button" onClick={() => open({ kind: "absence" })} className="h-[52px] flex-1 rounded-xl bg-[var(--cn-accent)] px-2 text-[16px] font-bold text-white">
            欠勤・早退
          </button>
          <button type="button" onClick={() => open({ kind: "escort" })} className="h-[52px] flex-1 rounded-xl bg-[var(--cn-accent)] px-2 text-[16px] font-bold text-white">
            付き添い・外出
          </button>
        </div>
        <div className="px-3 pb-1 pt-2">
          <button
            type="button"
            onClick={undo}
            disabled={!lastUndo}
            className="flex h-[44px] w-full items-center gap-2 rounded-lg border border-[var(--cn-control-line)] px-3 text-left text-[15px] disabled:border-[var(--cn-border)] disabled:text-[var(--cn-muted)]"
          >
            <span className="shrink-0 font-bold">元に戻す</span>
            <span className="min-w-0 truncate text-[14px] text-[var(--cn-ink-soft)]">{lastUndo ? `（${lastUndo.label}）` : "（戻せる操作はありません）"}</span>
          </button>
        </div>
        {tabs}
      </div>

      {sheet?.kind === "menu" && sheetTask && engine && <MenuSheet state={state} engine={engine} taskId={sheetTask.id} onClose={close} onApply={apply} />}
      {sheet?.kind === "assign" && sheetTask && engine && <AssignSheet state={state} taskId={sheetTask.id} onClose={close} onApply={apply} engine={engine} />}
      {sheet?.kind === "escort" && engine && <EscortFlow state={state} engine={engine} date={date} now={now} onClose={close} onApply={apply} />}
      {sheet?.kind === "absence" && engine && <AbsenceFlow state={state} engine={engine} date={date} clock={clock} onClose={close} onApply={apply} />}
    </main>
  );
}

// ---------------------------------------------------------------------------
// 一覧の行
// ---------------------------------------------------------------------------

function Badge({ row }: { row: AllRow }) {
  if (!row.unfilled) return null;
  const un = row.status.level === "unassigned";
  return (
    <span
      className={`inline-flex h-[28px] items-center rounded-md border px-2 text-[14px] font-bold ${
        un ? "border-dashed border-[var(--cn-alert-line)] bg-[var(--cn-unassigned-bg)] text-[var(--cn-unassigned-ink)]" : "border-[var(--cn-alert-line)] bg-[var(--cn-short-bg)] text-[var(--cn-short-ink)]"
      }`}
    >
      {row.status.label}
    </span>
  );
}

function Row({ row, flash, onMenu, onAdd }: { row: AllRow; flash: boolean; onMenu: () => void; onAdd: () => void }) {
  const t = row.task;
  const id = `ar-${t.id}`;
  return (
    <li
      data-all-task={t.id}
      tabIndex={-1}
      aria-labelledby={id}
      className={`flex items-start gap-2 border-b border-[var(--cn-grid)] px-3 py-2.5 outline-none last:border-b-0 focus-visible:outline-3 ${
        flash ? "bg-[var(--cn-short-bg)]" : row.isBreak ? "bg-[var(--cn-break-bg)]" : ""
      } ${row.past || row.cancelled ? "text-[var(--cn-muted)]" : ""}`}
    >
      <div className="min-w-0 flex-1">
        <p id={id} className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-bold">{fmtRange(t.startMin, t.endMin)}</span>
          <span className={`font-bold ${row.cancelled ? "line-through" : ""}`}>{row.label}</span>
          {row.count && <span className="text-[14px]">{row.count}</span>}
          {row.cancelled && <span className="rounded border border-[var(--cn-control-line)] px-1.5 text-[14px] font-bold text-[var(--cn-ink)]">中止</span>}
          {row.past && !row.cancelled && <span className="sr-only">（時刻を過ぎた業務）</span>}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px]">
          <span className={row.past || row.cancelled ? "" : "text-[var(--cn-ink-soft)]"}>
            担当: {row.assignees.length > 0 ? row.assignees.map((s) => s.surname).join("・") : "まだいません"}
          </span>
          <Badge row={row} />
          {flash && <span className="text-[14px] font-bold text-[var(--cn-ink)]">変わりました</span>}
        </p>
      </div>
      {row.unfilled && (
        <button
          type="button"
          onClick={onAdd}
          aria-label={`「${row.label} ${fmtRange(t.startMin, t.endMin)}」に担当を追加`}
          className="inline-flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-lg border border-dashed border-[var(--cn-control-line)] bg-white text-[22px] font-bold text-[var(--cn-ink)]"
        >
          ＋
        </button>
      )}
      <button
        type="button"
        onClick={onMenu}
        aria-label={`「${row.label} ${fmtRange(t.startMin, t.endMin)}」のほかの操作（中止・ずらす・担当を外す）`}
        className="inline-flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-lg border border-[var(--cn-control-line)] bg-white text-[18px] font-bold text-[var(--cn-ink)]"
      >
        ⋯
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// ⋯（中止・ずらす・担当を外す）。どれも1タップで決まり、元に戻せる
// ---------------------------------------------------------------------------

type Apply = (events: Event[], label: string, keepOpen?: boolean) => Promise<void>;

function MenuSheet({ state, engine, taskId, onClose, onApply }: { state: State; engine: Engine; taskId: ID; onClose: () => void; onApply: Apply }) {
  const task = state.tasks[taskId];
  const rows = allRows(state, task.date, 0);
  const row = rows.find((r) => r.task.id === taskId)!;
  const isBreak = task.kind === "break";
  const cancelled = task.status === "cancelled";
  const [notice, setNotice] = useState<string | null>(null);
  const title = `${row.label} ${fmtRange(task.startMin, task.endMin)}`;

  const shift = (delta: number, staffId?: ID) => {
    const word = `${Math.abs(delta)}分${delta > 0 ? "後へ" : "前へ"}`;
    if (isBreak && staffId) {
      const p = shiftBreakPreview(engine.state, task.id, delta, engine.context(), staffId);
      if (p.events.length === 0) {
        setNotice(p.lines[0]?.text ?? "ずらせませんでした");
        return;
      }
      onApply(p.events, `${state.staff[staffId]?.surname ?? ""}さんの休憩を${word}ずらしました`);
      return;
    }
    onApply(shiftTaskEvents(engine.state, task.id, delta, engine.context()), `「${row.label}」を${word}ずらしました`);
  };

  const btn = "flex min-h-[48px] w-full items-center rounded-xl border border-[var(--cn-control-line)] bg-white px-4 text-left text-[16px]";
  return (
    <Sheet title={title} subtitle="ほかの操作" onClose={onClose}>
      {notice && (
        <p role="alert" className="rounded-xl border-2 border-[var(--cn-alert-line)] bg-white p-3">
          {notice}
        </p>
      )}
      {!cancelled && (
        <section aria-labelledby="menu-shift">
          <h3 id="menu-shift" className="mb-1.5 text-[14px] font-bold text-[var(--cn-muted)]">
            ずらす（長さはそのまま）
          </h3>
          {isBreak && row.assignees.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {row.assignees.map((s) => (
                <li key={s.id} className="flex gap-2">
                  <button type="button" className={`${btn} font-bold`} onClick={() => shift(30, s.id)}>
                    {s.surname}さんの休憩を 30分後へ
                  </button>
                  <button type="button" className={`${btn} w-auto shrink-0`} onClick={() => shift(-30, s.id)}>
                    30分前へ
                  </button>
                </li>
              ))}
              <li className="text-[14px] text-[var(--cn-ink-soft)]">休憩はその人の分だけ動きます。勤務時間の外へはずらせません。</li>
            </ul>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className={`${btn} font-bold`} onClick={() => shift(30)}>
                30分後へ
              </button>
              <button type="button" className={btn} onClick={() => shift(-30)}>
                30分前へ
              </button>
              <button type="button" className={btn} onClick={() => shift(15)}>
                15分後へ
              </button>
              <button type="button" className={btn} onClick={() => shift(60)}>
                60分後へ
              </button>
            </div>
          )}
        </section>
      )}

      {!cancelled && row.assignees.length > 0 && !isBreak && (
        <section aria-labelledby="menu-unassign">
          <h3 id="menu-unassign" className="mb-1.5 text-[14px] font-bold text-[var(--cn-muted)]">
            担当を外す
          </h3>
          <ul className="flex flex-col gap-2">
            {row.assignees.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className={btn}
                  onClick={() => onApply(unassignEvents(engine.state, task.id, s.id, engine.context()), `${s.surname}さんを「${row.label}」の担当から外しました`)}
                >
                  {s.surname}さんを外す
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!isBreak && (
        <section aria-labelledby="menu-cancel">
          <h3 id="menu-cancel" className="mb-1.5 text-[14px] font-bold text-[var(--cn-muted)]">
            中止
          </h3>
          {cancelled ? (
            <button type="button" className={btn} onClick={() => onApply(restoreTaskEvents(task.id, engine.context()), `「${row.label}」の中止を取り消しました`)}>
              中止を取り消す
            </button>
          ) : (
            <button type="button" className={btn} onClick={() => onApply(cancelTaskEvents(task.id, engine.context()), `「${row.label}」を中止にしました`)}>
              この業務を中止（一覧には残ります）
            </button>
          )}
        </section>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// ＋（担当の追加）。ボードのパネルと同じ並び: 問題なし → ほかの人（注意 n・勤務外 n）
// ---------------------------------------------------------------------------

function CandidateList({ cands, onPick, pickLabel }: { cands: Candidate[]; onPick: (c: Candidate) => void; pickLabel: string }) {
  const [showOthers, setShowOthers] = useState(false);
  const { open, folded, warnCount, offCount } = splitCandidates(cands);
  const row = (c: Candidate, canAdd: boolean) => (
    <li key={c.staff.id} className="flex items-center gap-3 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-2">
          <span className="font-bold">{c.staff.surname}</span>
          {c.entry?.firstTimer && <span className="rounded border border-[var(--cn-control-line)] px-1 text-[14px]">初回</span>}
        </p>
        <p className="text-[14px] text-[var(--cn-ink-soft)]">
          {c.tier === "warn" && <span className="font-bold text-[var(--cn-short-ink)]">注意: </span>}
          {c.issues[0]?.message ?? (c.sameSlot ? "この業務の番です" : "この時間は空いています")}
        </p>
      </div>
      {canAdd && (
        <button
          type="button"
          onClick={() => onPick(c)}
          aria-label={`${c.staff.surname}さんを${pickLabel}`}
          className={`h-[44px] shrink-0 rounded-lg px-4 text-[16px] font-bold ${c.tier === "ok" ? "bg-[var(--cn-accent)] text-white" : "border border-[var(--cn-control-line)] bg-white"}`}
        >
          {pickLabel}
        </button>
      )}
    </li>
  );
  return (
    <>
      <section aria-labelledby="cand-ok">
        <h3 id="cand-ok" className="mb-1.5 text-[14px] font-bold text-[var(--cn-muted)]">
          問題なし {open.length}人
        </h3>
        {open.length > 0 ? (
          <ul className="divide-y divide-[var(--cn-grid)] rounded-xl border border-[var(--cn-border)] bg-white">{open.map((c) => row(c, true))}</ul>
        ) : (
          <p className="rounded-xl bg-[var(--cn-ground)] p-3">この時間に空いている人はいません。下の「ほかの人」から選べます。</p>
        )}
      </section>
      {folded.length > 0 && (
        <section>
          <button
            type="button"
            aria-expanded={showOthers}
            onClick={() => setShowOthers((v) => !v)}
            className="flex h-[48px] w-full items-center justify-between rounded-xl border border-[var(--cn-control-line)] bg-white px-3 text-left"
          >
            <span>
              ほかの人（注意 {warnCount}・勤務外 {offCount}）
            </span>
            <span aria-hidden="true">{showOthers ? "▴" : "▾"}</span>
          </button>
          {showOthers && <ul className="mt-2 divide-y divide-[var(--cn-grid)] rounded-xl border border-[var(--cn-border)] bg-white">{folded.map((c) => row(c, c.tier === "warn"))}</ul>}
        </section>
      )}
    </>
  );
}

function AssignSheet({ state, engine, taskId, onClose, onApply }: { state: State; engine: Engine; taskId: ID; onClose: () => void; onApply: Apply }) {
  const task = state.tasks[taskId];
  const row = allRows(state, task.date, 0).find((r) => r.task.id === taskId)!;
  const cands = useMemo(() => candidatesForPreview(state, [], taskId), [state, taskId]);
  return (
    <Sheet title={`${row.label} ${fmtRange(task.startMin, task.endMin)}`} subtitle="担当を追加" badge={<Badge row={row} />} onClose={onClose}>
      <CandidateList
        cands={cands}
        pickLabel="追加"
        onPick={(c) => {
          const evs = assignEvents(task.id, c.staff.id, engine.context());
          // まだ足りないときは開いたまま（続けて追加できる）
          const stillShort = row.status.required - row.status.assigned > 1;
          onApply(evs, `${c.staff.surname}さんを「${row.label}」の担当にしました`, stillShort);
        }}
      />
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// クイック操作: 付き添い・外出（ボタン → 利用者 → この内容で決定）
// 既定: 受診の付き添い・今から90分・担当は空き。重なる休憩は後ろへずらす
// ---------------------------------------------------------------------------

function EscortFlow({ state, engine, date, now, onClose, onApply }: { state: State; engine: Engine; date: string; now: number; onClose: () => void; onApply: Apply }) {
  const [batchId] = useState(newBatchId);
  const [residentId, setResidentId] = useState<ID | null>(null);
  const [name, setName] = useState<string>(ESCORT_NAMES[0]);
  const def = defaultEscortRange(now);
  const [startMin, setStartMin] = useState(def.startMin);
  const [duration, setDuration] = useState(def.endMin - def.startMin);
  const [staffId, setStaffId] = useState<ID | undefined>(undefined);
  const [pickStaff, setPickStaff] = useState(false);
  const choices = useMemo(() => escortChoices(state), [state]);

  const preview = useMemo<Preview | null>(() => {
    if (!residentId) return null;
    return escortPreview(
      state,
      { date, residentId, name, startMin, endMin: startMin + duration, staffId, templateId: escortTemplateId(state, name) },
      stableContext(engine, batchId),
    );
  }, [state, engine, batchId, residentId, name, startMin, duration, staffId, date]);

  if (!residentId || !preview) {
    let lastGroup = "";
    return (
      <Sheet title="付き添い・外出" subtitle="どなたの付き添いですか" onClose={onClose}>
        <ul aria-label="利用者" className="flex flex-col gap-2">
          {choices.map((c) => {
            const head = c.groupName !== lastGroup ? c.groupName : "";
            lastGroup = c.groupName;
            return (
              <li key={c.resident.id}>
                {head && <p className="mb-1 mt-2 text-[14px] font-bold text-[var(--cn-muted)]">{head}</p>}
                <button
                  type="button"
                  onClick={() => setResidentId(c.resident.id)}
                  className="flex min-h-[48px] w-full items-center rounded-xl border border-[var(--cn-control-line)] bg-white px-4 text-left text-[17px] font-bold"
                >
                  {c.label}
                </button>
              </li>
            );
          })}
        </ul>
      </Sheet>
    );
  }

  const addEv = preview.events.find((e) => e.type === "task.add");
  const newTaskId = addEv && addEv.type === "task.add" ? addEv.task.id : undefined;
  const resident = state.residents[residentId];
  const chip = (on: boolean) =>
    `inline-flex h-[44px] items-center rounded-lg border px-3 text-[15px] ${on ? "border-2 border-[var(--cn-accent)] bg-[var(--cn-accent-soft)] font-bold text-[var(--cn-accent)]" : "border-[var(--cn-control-line)] bg-white"}`;

  return (
    <PreviewSheet
      resetKey={`${residentId}-${name}-${startMin}-${duration}-${staffId ?? ""}`}
      preview={preview}
      title="付き添い・外出"
      onClose={onClose}
      onBack={() => setResidentId(null)}
      backLabel="利用者を選び直す"
      onDecide={(events) => onApply(events, `${name}（${resident?.surname ?? ""}様 ${fmtRange(startMin, startMin + duration)}）を追加しました`)}
    >
      <section aria-labelledby="esc-kind">
        <h3 id="esc-kind" className="mb-1.5 text-[14px] font-bold text-[var(--cn-muted)]">
          種類
        </h3>
        <div className="flex flex-wrap gap-2">
          {ESCORT_NAMES.map((n) => (
            <button key={n} type="button" aria-pressed={n === name} onClick={() => setName(n)} className={chip(n === name)}>
              {n.replace("の付き添い", "")}
            </button>
          ))}
        </div>
      </section>
      <section aria-labelledby="esc-time">
        <h3 id="esc-time" className="mb-1.5 text-[14px] font-bold text-[var(--cn-muted)]">
          時間 {fmtRange(startMin, startMin + duration)}
        </h3>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setStartMin((v) => v - 15)} className={chip(false)} aria-label={`開始を15分早く（いま ${fmtMin(startMin)}）`}>
            開始 −15分
          </button>
          <button type="button" onClick={() => setStartMin((v) => v + 15)} className={chip(false)} aria-label={`開始を15分遅く（いま ${fmtMin(startMin)}）`}>
            開始 ＋15分
          </button>
          {[60, 90, 120, 180].map((dmin) => (
            <button key={dmin} type="button" aria-pressed={dmin === duration} onClick={() => setDuration(dmin)} className={chip(dmin === duration)}>
              {dmin}分
            </button>
          ))}
        </div>
      </section>
      <section aria-labelledby="esc-staff">
        <h3 id="esc-staff" className="mb-1.5 text-[14px] font-bold text-[var(--cn-muted)]">
          担当
        </h3>
        {staffId ? (
          <div className="flex items-center gap-2">
            <span className="font-bold">{state.staff[staffId]?.surname}</span>
            <button type="button" onClick={() => setStaffId(undefined)} className={chip(false)}>
              担当を決めずに足す
            </button>
          </div>
        ) : pickStaff && newTaskId ? (
          <CandidateList
            cands={candidatesForPreview(state, preview.events, newTaskId)}
            pickLabel="担当にする"
            onPick={(c) => {
              setStaffId(c.staff.id);
              setPickStaff(false);
            }}
          />
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span>まだ決めない（担当未定で足します）</span>
            <button type="button" onClick={() => setPickStaff(true)} className={chip(false)}>
              担当を選ぶ
            </button>
          </div>
        )}
      </section>
    </PreviewSheet>
  );
}

// ---------------------------------------------------------------------------
// クイック操作: 欠勤・早退（ボタン → 職員 → この内容で決定）
// 出勤前は欠勤、勤務中は今の時刻で早退
// ---------------------------------------------------------------------------

function AbsenceFlow({ state, engine, date, clock, onClose, onApply }: { state: State; engine: Engine; date: string; clock: number; onClose: () => void; onApply: Apply }) {
  const [batchId] = useState(newBatchId);
  const [staffId, setStaffId] = useState<ID | null>(null);
  const choices = useMemo(() => absenceChoices(state, date), [state, date]);

  const preview = useMemo<Preview | null>(() => {
    if (!staffId) return null;
    return absencePreview(state, date, staffId, stableContext(engine, batchId), viewerMinutes(state, date, staffId, clock));
  }, [state, engine, batchId, staffId, date, clock]);

  if (!staffId || !preview) {
    return (
      <Sheet title="欠勤・早退" subtitle="どの職員ですか（勤務前は欠勤、勤務中はいまの時刻で早退）" onClose={onClose}>
        <ul aria-label="きょうの出勤者" className="flex flex-col gap-2">
          {choices.map((c) => {
            const kind = absenceKind(c.entry, viewerMinutes(state, date, c.staff.id, clock));
            const done = kind === "勤務後";
            return (
              <li key={c.entry.id}>
                <button
                  type="button"
                  disabled={done}
                  onClick={() => setStaffId(c.staff.id)}
                  className="flex min-h-[52px] w-full items-center gap-3 rounded-xl border border-[var(--cn-control-line)] bg-white px-4 text-left disabled:border-[var(--cn-border)] disabled:text-[var(--cn-muted)]"
                >
                  <span className="text-[17px] font-bold">{c.staff.surname}</span>
                  <span className="text-[14px]">
                    {c.slotName} {fmtRange(c.entry.startMin, c.entry.endMin)}
                  </span>
                  <span className="ml-auto text-[14px] font-bold">{done ? "勤務を終えています" : kind}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </Sheet>
    );
  }

  const name = state.staff[staffId]?.surname ?? "";
  return (
    <PreviewSheet
      key={staffId}
      preview={preview}
      title={preview.title}
      onClose={onClose}
      onBack={() => setStaffId(null)}
      backLabel="職員を選び直す"
      onDecide={(events) => onApply(events, `${name}さんを${preview.title}にしました`)}
    />
  );
}
