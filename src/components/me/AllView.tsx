"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Event } from "@/domain/events";
import { splitCandidates, type Candidate } from "@/domain/checks";
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
import {
  absenceChoices,
  absenceKind,
  allRows,
  candidatesForPreview,
  escortChoices,
  escortTemplateId,
  firstUpcomingIndex,
  overnightRows,
  leaveAt,
  shiftCheck,
  touchedTaskIds,
  unfilledGroups,
  type AllRow,
} from "@/domain/leader";
import { businessMinutes } from "@/domain/myday";
import type { EventContext } from "@/domain/pattern";
import { fmtMin, fmtRange } from "@/domain/time";
import { MAX_MINUTES, type ID, type State } from "@/domain/types";
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
  const groups = useMemo(() => unfilledGroups(rows), [rows]);
  const overnight = useMemo(() => overnightRows(state, date, now), [state, date, now]);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [flash, setFlash] = useState<Set<ID>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  // 開いたら、いまの時間の行へ寄せる（遅番・夜勤が開いても 7:00 からスクロールしない）
  const scrolled = useRef(false);
  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
    document.title = "全体 — ケアナビ";
  }, []);
  useEffect(() => {
    if (scrolled.current || rows.length === 0) return;
    scrolled.current = true;
    document.getElementById("all-now")?.scrollIntoView({ block: "center" });
  }, [rows]);

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
      if (keepOpen) {
        // 押したボタンが並び替えで消えることがあるので、シートの見出しへ
        window.setTimeout(() => document.getElementById("sheet-title")?.focus(), 0);
      } else {
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
    if (done) setToast(`戻しました（${done.label}）`);
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
  const upcoming = firstUpcomingIndex(rows, now);
  // シートを開いている間は背面を操作できないようにする（フォーカスが外へ出ない）
  const inert = sheet ? true : undefined;

  return (
    <main className="mx-auto min-h-screen max-w-[480px] bg-[var(--cn-ground)] pb-[130px] text-[16px]">
      <style>{`html { scroll-padding-top: 120px; scroll-padding-bottom: ${toast ? 200 : 140}px; } @media (max-height: 640px) { .cn-all-head { position: static !important; } }`}</style>
      <div inert={inert}>
      <header className="cn-all-head sticky top-0 z-20 border-b border-[var(--cn-border)] bg-white px-4 pb-3 pt-4">
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
                {g.label} {g.count}件<span className="sr-only">（該当の行へ移る）</span>
              </button>
            ))}
          </div>
        ) : (
          rows.length > 0 && <p className="mt-1 text-[16px] text-[var(--cn-ink-soft)]">これからの業務で、担当未定はありません。</p>
        )}
      </header>

      {overnight.length > 0 && (
        <section aria-labelledby="overnight-title" className="mx-4 mt-4 rounded-xl border border-dashed border-[var(--cn-control-line)] bg-white p-3">
          <h2 id="overnight-title" className="text-[16px] font-bold">
            夜勤明け（前日の夜勤の業務）
          </h2>
          <p className="text-[14px] text-[var(--cn-ink-soft)]">前日の時間割に入っている業務です。ここでは見るだけです（変えるときは前日のボードで）。</p>
          <ul className="mt-1 flex flex-col divide-y divide-[var(--cn-card-line)]">
            {overnight.map((r) => (
              <li key={r.task.id} className="py-2">
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-bold">{r.timeText}</span>
                  <span className="font-bold">{r.label}</span>
                  {r.count && <span className="text-[14px]">{r.count}</span>}
                </p>
                <p className="flex flex-wrap items-center gap-x-2 text-[16px] text-[var(--cn-ink-soft)]">
                  {r.isBreak ? "休憩" : "担当"}: {r.assignees.length > 0 ? r.assignees.map((x) => x.surname).join("・") : "まだいません"}
                  <Badge row={r} />
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {rows.length === 0 ? (
        <section className="m-4 flex flex-col items-start gap-3 rounded-xl bg-white p-4">
          <p>きょうの時間割はまだできていません。施設の PC のボードで「この内容で作る」を押すと、ここに出ます。</p>
          <button type="button" onClick={() => window.location.reload()} className="h-[48px] rounded-xl border border-[var(--cn-control-line)] px-4 font-bold">
            もう一度読み込む
          </button>
        </section>
      ) : (
        <ol aria-label="きょうの業務（時間順）" className="m-4 flex flex-col overflow-hidden rounded-xl border border-[var(--cn-border)] bg-white">
          {rows.map((r, i) => (
            <Fragment key={r.task.id}>
              {i === upcoming && <NowLine now={now} />}
              <Row row={r} flash={flash.has(r.task.id)} onMenu={() => open({ kind: "menu", taskId: r.task.id })} onAdd={() => open({ kind: "assign", taskId: r.task.id })} />
            </Fragment>
          ))}
          {upcoming < 0 && <NowLine now={now} />}
        </ol>
      )}

      {/* 画面下（親指の位置）: クイック操作と元に戻す。その下に［自分｜全体］ */}
      <div className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-[480px] border-t border-[var(--cn-control-line)] bg-white">
        {toast && (
          <div className="absolute inset-x-3 bottom-full mb-2 flex items-center gap-2 rounded-xl bg-[var(--cn-ink)] px-3 py-2 text-[16px] text-white shadow-lg">
            <p role="status" className="min-w-0 flex-1">
              {toast}
            </p>
            {lastUndo && !toast.startsWith("戻しました") && (
              <button type="button" onClick={undo} className="h-[44px] shrink-0 rounded-lg border border-white px-3 font-bold">
                元に戻す
              </button>
            )}
          </div>
        )}
        <div className="flex gap-2 px-3 py-2">
          <button type="button" onClick={() => open({ kind: "absence" })} className="h-[52px] flex-1 rounded-xl bg-[var(--cn-accent)] px-2 text-[16px] font-bold text-white">
            欠勤・早退
          </button>
          <button type="button" onClick={() => open({ kind: "escort" })} className="h-[52px] flex-1 rounded-xl bg-[var(--cn-accent)] px-2 text-[16px] font-bold text-white">
            付き添い・外出
          </button>
          {/* 元に戻す（常設）。直前の操作名は読み上げとトーストで伝える */}
          <button
            type="button"
            onClick={undo}
            disabled={!lastUndo}
            aria-label={lastUndo ? `元に戻す（${lastUndo.label}）` : "元に戻す（戻せる操作はありません）"}
            className="h-[52px] w-[92px] shrink-0 rounded-xl border-2 border-[var(--cn-control-line)] bg-white text-[16px] font-bold disabled:border-[var(--cn-border)] disabled:text-[var(--cn-muted)]"
          >
            元に戻す
          </button>
        </div>
        {tabs}
      </div>
      </div>

      {sheet?.kind === "menu" && sheetTask && engine && <MenuSheet state={state} engine={engine} taskId={sheetTask.id} now={now} onClose={close} onApply={apply} />}
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

function NowLine({ now }: { now: number }) {
  return (
    <li id="all-now" className="flex items-center gap-2 border-y-2 border-[var(--cn-now)] px-3 py-1.5 text-[16px] font-bold text-[var(--cn-now)]">
      ● いまの時間 {fmtMin(now)}
    </li>
  );
}

function Row({ row, flash, onMenu, onAdd }: { row: AllRow; flash: boolean; onMenu: () => void; onAdd: () => void }) {
  const t = row.task;
  const id = `ar-${t.id}`;
  const noNeed = !row.isBreak && row.status.required === 0 && row.assignees.length === 0;
  return (
    <li
      data-all-task={t.id}
      tabIndex={-1}
      aria-labelledby={id}
      aria-describedby={noNeed ? undefined : `${id}-sub`}
      className={`flex items-start gap-2 border-b border-[var(--cn-card-line)] px-3 py-2.5 outline-none last:border-b-0 focus-visible:outline-3 ${
        flash ? "bg-[var(--cn-short-bg)]" : row.isBreak ? "bg-[var(--cn-break-bg)]" : ""
      } ${row.past || row.cancelled ? "border-l-4 border-l-[var(--cn-control-line)] text-[var(--cn-muted)]" : ""}`}
    >
      <div className="min-w-0 flex-1">
        <p id={id} className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-bold">{fmtRange(t.startMin, t.endMin)}</span>
          <span className={`font-bold ${row.cancelled ? "line-through" : ""}`}>{row.label}</span>
          {row.count && <span className="text-[14px]">{row.count}</span>}
          {row.cancelled && <span className="rounded border border-[var(--cn-control-line)] px-1.5 text-[14px] font-bold text-[var(--cn-ink)]">中止</span>}
          {row.past && !row.cancelled && <span className="text-[14px]">（時刻を過ぎました）</span>}
        </p>
        {!noNeed && (
          <p id={`${id}-sub`} className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[16px]">
            <span className={row.past || row.cancelled ? "" : "text-[var(--cn-ink-soft)]"} aria-hidden={row.assignees.length === 0 && row.unfilled ? true : undefined}>
              {row.isBreak ? "休憩" : "担当"}: {row.assignees.length > 0 ? row.assignees.map((s) => s.surname).join("・") : "まだいません"}
            </span>
            <Badge row={row} />
            {flash && <span className="text-[14px] font-bold text-[var(--cn-ink)]">変わりました</span>}
          </p>
        )}
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

function MenuSheet({ state, engine, taskId, now, onClose, onApply }: { state: State; engine: Engine; taskId: ID; now: number; onClose: () => void; onApply: Apply }) {
  const task = state.tasks[taskId];
  const rows = allRows(state, task.date, 0);
  const row = rows.find((r) => r.task.id === taskId)!;
  const isBreak = task.kind === "break";
  const cancelled = task.status === "cancelled";
  const [notice, setNotice] = useState<string | null>(null);
  const title = `${row.label} ${fmtRange(task.startMin, task.endMin)}`;
  // 時刻を過ぎた（始まりがいまより前）業務は「いまから」（15分切り上げ）へ動かせる
  const nowStart = Math.ceil(now / 15) * 15;
  const fromNow = task.startMin < now && !isBreak ? nowStart - task.startMin : null;

  // ずらしたあとの重なりは止めずに、トーストの文に添える（担当が残ったまま休憩に入るのを見落とさない）
  const shift = (delta: number, staffId?: ID) => {
    const to = fmtRange(task.startMin + delta, task.endMin + delta);
    if (isBreak && staffId) {
      const p = shiftBreakPreview(engine.state, task.id, delta, engine.context(), staffId);
      if (p.events.length === 0) {
        setNotice(p.lines[0]?.text ?? "ずらせませんでした");
        return;
      }
      const overlaps = p.lines.filter((l) => l.kind === "effect").map((l) => l.text);
      onApply(p.events, `${state.staff[staffId]?.surname ?? ""}さんの休憩を ${to} にしました${overlaps.length ? `。${overlaps.join("。")}` : ""}`);
      return;
    }
    const check = shiftCheck(engine.state, task.id, delta);
    if (!check.ok) {
      setNotice(check.message ?? "ずらせませんでした");
      return;
    }
    onApply(shiftTaskEvents(engine.state, task.id, delta, engine.context()), `「${row.label}」を ${to} にしました${check.conflicts.length ? `。${check.conflicts.join("。")}` : ""}`);
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
              {/* 動いた後の時刻をボタンに書く（起点は予定の時刻）。時刻を過ぎた業務には「いまから」を先に出す */}
              {fromNow !== null && (
                <button type="button" className={`${btn} col-span-2 font-bold`} onClick={() => shift(fromNow)}>
                  いまから（{fmtRange(task.startMin + fromNow, task.endMin + fromNow)}）
                </button>
              )}
              {[15, 30, 60, -30].map((dm) => (
                <button key={dm} type="button" className={`${btn} flex-col !items-start justify-center ${dm === 30 && fromNow === null ? "font-bold" : ""}`} onClick={() => shift(dm)}>
                  <span>{dm > 0 ? `${dm}分後へ` : `${-dm}分前へ`}</span>
                  <span className="text-[14px] font-normal text-[var(--cn-ink-soft)]">{fmtRange(task.startMin + dm, task.endMin + dm)}</span>
                </button>
              ))}
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
                  onClick={() => onApply(unassignEvents(engine.state, task.id, s.id, engine.context()), `${s.surname}さんを「${row.label} ${fmtMin(task.startMin)}」の担当から外しました`)}
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
            <button type="button" className={btn} onClick={() => onApply(restoreTaskEvents(task.id, engine.context()), `「${row.label} ${fmtMin(task.startMin)}」の中止を取り消しました`)}>
              中止を取り消す
            </button>
          ) : (
            <button type="button" className={btn} onClick={() => onApply(cancelTaskEvents(task.id, engine.context()), `「${row.label} ${fmtMin(task.startMin)}」を中止にしました`)}>
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

function CandidateList({ state, cands, onPick, pickLabel }: { state: State; cands: Candidate[]; onPick: (c: Candidate) => void; pickLabel: string }) {
  const [showOthers, setShowOthers] = useState(false);
  const { open, folded, warnCount, offCount } = splitCandidates(cands);
  const row = (c: Candidate, canAdd: boolean) => (
    <li key={c.staff.id} className="flex items-center gap-3 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-2">
          <span className="font-bold">{c.staff.surname}</span>
          {c.entry?.slotId && state.roleSlots[c.entry.slotId] && <span className="text-[14px] text-[var(--cn-ink-soft)]">{state.roleSlots[c.entry.slotId].name}</span>}
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
        state={state}
        cands={cands}
        pickLabel="追加"
        onPick={(c) => {
          const evs = assignEvents(task.id, c.staff.id, engine.context());
          // まだ足りないときは開いたまま（続けて追加できる）
          const stillShort = row.status.required - row.status.assigned > 1;
          onApply(evs, `${c.staff.surname}さんを「${row.label} ${fmtMin(task.startMin)}」の担当にしました`, stillShort);
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
  const [group, setGroup] = useState<string | null>(null);
  // その日の時間割（0:00〜翌 23:59）の中に収める
  const maxEnd = MAX_MINUTES - 1;

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
    const groupNames = [...new Set(choices.map((c) => c.groupName))];
    const shown = group ? choices.filter((c) => c.groupName === group) : choices;
    return (
      <Sheet title="付き添い・外出" subtitle="どなたの付き添いですか" onClose={onClose}>
        {groupNames.length > 1 && (
          <div role="group" aria-label="フロア・ユニットで絞る" className="flex flex-wrap gap-2">
            {[null, ...groupNames].map((g) => (
              <button
                key={g ?? "all"}
                type="button"
                aria-pressed={group === g}
                onClick={() => setGroup(g)}
                className={`inline-flex h-[44px] items-center rounded-lg border px-3 text-[15px] ${
                  group === g ? "border-2 border-[var(--cn-accent)] bg-[var(--cn-accent-soft)] font-bold text-[var(--cn-accent)]" : "border-[var(--cn-control-line)] bg-white"
                }`}
              >
                {g ?? "すべて"}
              </button>
            ))}
          </div>
        )}
        <ul aria-label="利用者" className="flex flex-col gap-2">
          {shown.map((c) => {
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
  const topCandidate = newTaskId ? candidatesForPreview(state, preview.events, newTaskId).find((c) => c.tier === "ok") : undefined;
  const chip = (on: boolean) =>
    `inline-flex h-[44px] items-center rounded-lg border px-3 text-[15px] ${on ? "border-2 border-[var(--cn-accent)] bg-[var(--cn-accent-soft)] font-bold text-[var(--cn-accent)]" : "border-[var(--cn-control-line)] bg-white"}`;

  return (
    <PreviewSheet
      state={state}
      date={date}
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
          <button
            type="button"
            disabled={startMin - 15 < 0}
            onClick={() => setStartMin((v) => v - 15)}
            className={`${chip(false)} disabled:text-[var(--cn-muted)]`}
            aria-label={`開始を15分早く（いま ${fmtMin(startMin)}）`}
          >
            開始 −15分
          </button>
          <button
            type="button"
            disabled={startMin + 15 + duration > maxEnd}
            onClick={() => setStartMin((v) => v + 15)}
            className={`${chip(false)} disabled:text-[var(--cn-muted)]`}
            aria-label={`開始を15分遅く（いま ${fmtMin(startMin)}）`}
          >
            開始 ＋15分
          </button>
          {[60, 90, 120, 180].map((dmin) => (
            <button
              key={dmin}
              type="button"
              disabled={startMin + dmin > maxEnd}
              aria-pressed={dmin === duration}
              onClick={() => setDuration(dmin)}
              className={`${chip(dmin === duration)} disabled:text-[var(--cn-muted)]`}
            >
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
            state={state}
            cands={candidatesForPreview(state, preview.events, newTaskId)}
            pickLabel="担当にする"
            onPick={(c) => {
              setStaffId(c.staff.id);
              setPickStaff(false);
            }}
          />
        ) : (
          <div className="flex flex-col items-start gap-2">
            <span>まだ決めない（担当未定で足します）</span>
            <div className="flex flex-wrap gap-2">
              {/* 「問題なし」の先頭の人を1タップで付けられる（docs/screens.md §4.1） */}
              {topCandidate && (
                <button type="button" onClick={() => setStaffId(topCandidate.staff.id)} className={`${chip(false)} font-bold`}>
                  {topCandidate.staff.surname}さんを担当にする
                </button>
              )}
              <button type="button" onClick={() => setPickStaff(true)} className={chip(false)}>
                {topCandidate ? "ほかの人から選ぶ" : "担当を選ぶ"}
              </button>
            </div>
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
  const [force, setForce] = useState<"absent" | "leave" | undefined>(undefined);
  const choices = useMemo(() => absenceChoices(state, date), [state, date]);
  // 判定はその業務日の時刻で（夜勤明けの読み替えは使わない。今夜の夜勤の人は朝なら欠勤）
  const now = businessMinutes(clock);

  const preview = useMemo<Preview | null>(() => {
    if (!staffId) return null;
    return absencePreview(state, date, staffId, stableContext(engine, batchId), now, force);
  }, [state, engine, batchId, staffId, date, now, force]);

  if (!staffId || !preview) {
    return (
      <Sheet title="欠勤・早退" subtitle="どの職員ですか（勤務前は欠勤、勤務中はいまの時刻で早退）" onClose={onClose}>
        <ul aria-label="きょうの出勤者" className="flex flex-col gap-2">
          {choices.map((c) => {
            const kind = absenceKind(c.entry, now);
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
  const entry = choices.find((c) => c.staff.id === staffId)?.entry;
  const auto = entry ? absenceKind(entry, now) : "欠勤";
  const at = entry ? leaveAt(entry, now) : now;
  const chosen = preview.title;
  const chip = (on: boolean) =>
    `inline-flex h-[44px] items-center rounded-lg border px-3 text-[15px] ${on ? "border-2 border-[var(--cn-accent)] bg-[var(--cn-accent-soft)] font-bold text-[var(--cn-accent)]" : "border-[var(--cn-control-line)] bg-white"}`;
  return (
    <PreviewSheet
      key={staffId}
      state={state}
      date={date}
      resetKey={force ?? "auto"}
      preview={preview}
      title={`${name}さん ${chosen}`}
      onClose={onClose}
      onBack={() => {
        setStaffId(null);
        setForce(undefined);
      }}
      backLabel="職員を選び直す"
      onDecide={(events) => onApply(events, chosen === "早退" ? `${name}さんを ${fmtMin(at)} で早退にしました` : `${name}さんを欠勤にしました`)}
    >
      {/* 勤務が始まっていれば既定は早退。来ていないなら1タップで欠勤に直す */}
      {auto === "早退" && (
        <section aria-labelledby="abs-kind">
          <h3 id="abs-kind" className="mb-1.5 text-[14px] font-bold text-[var(--cn-muted)]">
            出勤していましたか
          </h3>
          <div className="flex flex-wrap gap-2">
            <button type="button" aria-pressed={chosen === "早退"} onClick={() => setForce(undefined)} className={chip(chosen === "早退")}>
              早退（{fmtMin(at)} まで勤務）
            </button>
            <button type="button" aria-pressed={chosen === "欠勤"} onClick={() => setForce("absent")} className={chip(chosen === "欠勤")}>
              欠勤（来ていない）
            </button>
          </div>
        </section>
      )}
    </PreviewSheet>
  );
}
