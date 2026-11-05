"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useDefaultDate, useEngine } from "@/store/react";
import { SAMPLE_DATE } from "@/store/sample";
import { applyEvents } from "@/domain/reducer";
import { tasksForDate } from "@/domain/checks";
import { addRoutineEvents, addRoutineToDayEvents, removeRoutineEvents, retimeRoutineEvents, ROUTINE_BANDS, routinesInBand, routinesOf, sheetRowFor, type Routine, type RoutineBand } from "@/domain/routine";
import { residentsOfGroup, routineChangeEvents, routineGridCsvRows, type RoutineChange } from "@/domain/residentsIO";
import { clockLabel } from "@/domain/time";
import type { ID, State } from "@/domain/types";
import type { Event } from "@/domain/events";
import { CellPanel, changeLabel, type CellTarget } from "./CellPanel";
import { downloadCsv } from "./download";
import { RoutinePanel, type RoutinePanelResult, type RoutinePanelTarget } from "./RoutinePanel";

/**
 * 一覧: 縦に利用者、横にそのグループの日課。標準と違うマスだけ直す（決定記録 0004 §3）。
 * 行を選んで、列の見出しの「まとめて変える」から同じ時刻・なしを一度に入れる（1つの操作・1つの元に戻す）。
 */
export function RoutineGrid({ state, groupId, flash = [] }: { state: State; groupId: ID; flash?: ID[] }) {
  const engine = useEngine();
  const [band, setBand] = useState<RoutineBand>("all");
  const allRoutines = useMemo(() => routinesOf(state, groupId), [state, groupId]);
  const routines = useMemo(() => routinesInBand(allRoutines, band), [allRoutines, band]);
  const bandRange = ROUTINE_BANDS.find((b) => b.band === band)?.range;
  const residents = useMemo(() => residentsOfGroup(state, groupId), [state, groupId]);
  const [selected, setSelected] = useState<Set<ID>>(new Set());
  const [panel, setPanel] = useState<CellTarget | null>(null);
  const [routinePanel, setRoutinePanelState] = useState<RoutinePanelTarget | null>(null);
  // 閉じたら、開いたボタン（＋ 日課を足す／標準）へフォーカスを戻す
  const routineOpener = useRef<HTMLElement | null>(null);
  const setRoutinePanel = (t: RoutinePanelTarget | null) => {
    if (t) routineOpener.current = document.activeElement as HTMLElement | null;
    setRoutinePanelState(t);
    if (!t) {
      const el = routineOpener.current;
      window.setTimeout(() => {
        if (el && document.contains(el)) el.focus();
      }, 0);
    }
  };
  // 今日（ボードと同じ業務日）。時間割がもうできていれば、足した日課を今日にも入れられる
  const today = useDefaultDate(state, "business") ?? SAMPLE_DATE;
  const todayMade = tasksForDate(state, today).length > 0;
  const todayLabel = todayMade ? `${Number(today.slice(5, 7))}/${Number(today.slice(8, 10))}` : undefined;
  const groupName = state.groups[groupId]?.name ?? "";
  const chosen = residents.filter((r) => selected.has(r.id));
  const allChecked = residents.length > 0 && chosen.length === residents.length;

  // 貼り付けで足した方の行までスクロールする（行が描かれたあとに一度だけ）
  const scrolled = useRef<string>("");
  const flashKey = flash.join(",");
  const flashing = new Set(flash);
  const hasFlashRow = residents.some((r) => flashing.has(r.id));
  useEffect(() => {
    if (!flashKey || scrolled.current === flashKey || !hasFlashRow) return;
    scrolled.current = flashKey;
    const el = document.querySelector(`tr[data-resident-id="${CSS.escape(flash[0])}"]`);
    el?.scrollIntoView({ block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flashKey, hasFlashRow]);

  const toggle = (id: ID) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const decide = (c: RoutineChange) => {
    if (!engine || !panel) return;
    const events = routineChangeEvents(engine.state, engine.context(), panel.residentIds, panel.routine, c);
    const label = changeLabel(panel.who, panel.routine, c);
    setPanel(null);
    if (events.length > 0) void engine.dispatch(events, label);
  };

  // 日課を足す・標準の時刻を変える・外す（決定記録 0013）。業務表を直すので、次に時間割を作るときから入る
  const decideRoutine = (r: RoutinePanelResult) => {
    if (!engine || !routinePanel) return;
    const later = "（次に時間割を作るときから入ります）";
    let events: Event[] = [];
    let label = "";
    if (r.kind === "add") {
      const ctx = engine.context();
      events = addRoutineEvents(engine.state, { templateId: r.templateId, groupId, startMin: r.startMin, endMin: r.endMin, headcount: r.headcount }, ctx);
      // 足した日課の印（足す前のどの業務表にもない印）。同じ種類・同じ開始の日課がすでにあっても取り違えない
      const known = new Set(Object.values(engine.state.patterns).flatMap((p) => p.items.map((it) => it.routineId)));
      const added = events.flatMap((e) => (e.type === "pattern.upsert" ? e.pattern.items : [])).find((it) => it.routineId && !known.has(it.routineId))?.routineId;
      const todayEvents = r.today && added ? addRoutineToDayEvents(applyEvents(engine.state, events), today, added, groupId, ctx) : [];
      events = [...events, ...todayEvents];
      label = `${groupName}に「${state.templates[r.templateId]?.name ?? ""} ${clockLabel(r.startMin)}」を足しました${
        todayEvents.length > 0 ? `（今日 ${todayLabel} の時間割にも入れました）` : later
      }`;
      // 足した時間帯が見えるように「すべて」に戻す
      setBand("all");
    } else if (routinePanel.mode === "edit") {
      const rt = routinePanel.routine;
      events =
        r.kind === "retime"
          ? retimeRoutineEvents(engine.state, rt, r.startMin, r.endMin, engine.context(), r.headcount)
          : removeRoutineEvents(engine.state, rt, engine.context());
      label =
        r.kind === "retime"
          ? `${rt.name}を ${clockLabel(r.startMin)}–${clockLabel(r.endMin)}・${r.headcount}人にしました${later}`
          : `${rt.name}（${clockLabel(rt.startMin)}）を日課から外しました${later}`;
    }
    setRoutinePanel(null);
    if (events.length > 0) void engine.dispatch(events, label);
  };

  const openCell = (e: React.MouseEvent<HTMLButtonElement>, residentId: ID, routine: Routine) => {
    const r = state.residents[residentId];
    const row = sheetRowFor(state, residentId, routine.routineId);
    setPanel({
      who: `${r?.surname ?? ""}様`,
      residentIds: [residentId],
      routine,
      startMin: row?.startMin ?? routine.startMin,
      anchor: e.currentTarget.getBoundingClientRect(),
    });
  };

  const openBulk = (e: React.MouseEvent<HTMLButtonElement>, routine: Routine) => {
    if (chosen.length === 0) return;
    setPanel({
      who: chosen.length === 1 ? `${chosen[0].surname}様` : `選んだ${chosen.length}人`,
      residentIds: chosen.map((r) => r.id),
      routine,
      startMin: routine.startMin,
      anchor: e.currentTarget.getBoundingClientRect(),
    });
  };

  if (residents.length === 0) {
    return <p className="p-6 text-[var(--cn-ink-soft)]">{groupName}の利用者はまだいません。右上の「名簿を貼り付ける」から足せます。</p>;
  }

  return (
    <section aria-label={`${groupName}の日課の一覧`} className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 px-1 pb-2.5">
        <p className="text-[14px] text-[var(--cn-ink-soft)]">
          「—」は標準どおり。マスを押すとその方だけ直せます。行を選ぶと、列の「まとめて変える」で同じ時刻を一度に入れられます。列の「標準」を押すと、全員の時刻を変えられます。
        </p>
        <span className="text-[14px] font-bold" aria-live="polite">
          {chosen.length > 0 ? `${chosen.length}人を選んでいます` : ""}
        </span>
        <button
          type="button"
          onClick={() => downloadCsv(`日課の一覧_${groupName}.csv`, routineGridCsvRows(state, groupId))}
          className="ml-auto inline-flex h-[44px] items-center rounded-lg border border-[var(--cn-control-line)] bg-white px-4 text-[15px]"
        >
          CSV
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-3 px-1 pb-2.5">
        <div role="group" aria-label="時間帯" className="inline-flex overflow-hidden rounded-lg border border-[var(--cn-control-line)]">
          {ROUTINE_BANDS.map((b, i) => (
            <button
              key={b.band}
              type="button"
              aria-pressed={band === b.band}
              onClick={() => setBand(b.band)}
              className={`inline-flex h-[44px] items-center px-4 text-[15px] ${i > 0 ? "border-l border-[var(--cn-control-line)]" : ""} ${
                band === b.band ? "bg-[var(--cn-accent)] font-bold text-white" : "bg-white text-[var(--cn-ink)]"
              }`}
            >
              {b.label}
              {b.range && <span className="sr-only">（{b.range}）</span>}
            </button>
          ))}
        </div>
        <span className="text-[14px] text-[var(--cn-ink-soft)]">
          {bandRange ? `${bandRange} の日課 ${routines.length}件` : `日課 ${routines.length}件`}
        </span>
        <button
          type="button"
          onClick={(e) => setRoutinePanel({ mode: "add", anchor: e.currentTarget.getBoundingClientRect() })}
          className="inline-flex h-[44px] items-center rounded-lg border border-[var(--cn-accent)] bg-white px-4 text-[15px] font-bold text-[var(--cn-accent)]"
        >
          ＋ 日課を足す
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-[var(--cn-border)] bg-white">
        <table className="border-collapse text-[15px]">
          <thead className="sticky top-0 z-10 bg-white">
            <tr className="border-b border-[var(--cn-border)]">
              <th scope="col" className="sticky left-0 z-10 w-[52px] bg-white px-1">
                <label className="flex h-[44px] w-[44px] cursor-pointer items-center justify-center">
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={allChecked}
                    onChange={() => setSelected(allChecked ? new Set() : new Set(residents.map((r) => r.id)))}
                    aria-label="全員を選ぶ"
                  />
                </label>
              </th>
              <th scope="col" className="sticky left-[52px] z-10 min-w-[180px] bg-white px-3 text-left font-bold">
                利用者
              </th>
              {routines.map((rt) => (
                <th key={rt.routineId} scope="col" className="min-w-[148px] border-l border-[var(--cn-grid)] px-2 py-2 text-left align-top">
                  <span className="block font-bold">{rt.name}</span>
                  <button
                    type="button"
                    onClick={(e) => setRoutinePanel({ mode: "edit", routine: rt, anchor: e.currentTarget.getBoundingClientRect() })}
                    aria-label={`${rt.name} 標準 ${clockLabel(rt.startMin)}–${clockLabel(rt.endMin)}。押すと標準の時刻を変える・外す`}
                    className="-mx-1 flex min-h-[44px] items-center whitespace-nowrap rounded px-1 text-[14px] font-normal text-[var(--cn-ink-soft)] underline decoration-dotted underline-offset-4 hover:bg-[var(--cn-ground)]"
                  >
                    標準 {clockLabel(rt.startMin)}–{clockLabel(rt.endMin)}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => openBulk(e, rt)}
                    aria-disabled={chosen.length === 0}
                    title={chosen.length === 0 ? "先に左のチェックで方を選んでください" : undefined}
                    aria-label={`${rt.name}をまとめて変える${chosen.length > 0 ? `（${chosen.length}人）` : "（先に方を選ぶ）"}`}
                    className={`mt-1 inline-flex h-[44px] items-center whitespace-nowrap rounded-lg border px-2.5 text-[14px] font-normal ${
                      chosen.length === 0
                        ? "cursor-not-allowed border-[var(--cn-border)] text-[var(--cn-muted)]"
                        : "border-[var(--cn-accent)] bg-[var(--cn-accent-soft)] font-bold text-[var(--cn-accent)]"
                    }`}
                  >
                    まとめて変える
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {residents.map((r) => {
              const checked = selected.has(r.id);
              const isNew = flashing.has(r.id);
              const bg = isNew ? "bg-[var(--cn-short-bg)]" : checked ? "bg-[var(--cn-accent-soft)]" : "bg-white";
              return (
                <tr
                  key={r.id}
                  data-resident-id={r.id}
                  data-flash={isNew ? "true" : undefined}
                  className={`border-b border-[var(--cn-grid)] transition-colors duration-700 ${isNew || checked ? bg : ""}`}
                >
                  <td className={`sticky left-0 px-1 transition-colors duration-700 ${bg}`}>
                    <label className="flex h-[44px] w-[44px] cursor-pointer items-center justify-center">
                      <input type="checkbox" className="h-5 w-5" checked={checked} onChange={() => toggle(r.id)} aria-label={`${r.displayName}様を選ぶ`} />
                    </label>
                  </td>
                  <th scope="row" className={`sticky left-[52px] px-3 text-left font-normal transition-colors duration-700 ${bg}`}>
                    <span className="mr-2 text-[14px] text-[var(--cn-muted)]">{r.room}</span>
                    <span className="font-bold">{r.displayName}</span>様
                    {isNew && <span className="ml-2 rounded border border-[var(--cn-card-line)] bg-white px-1.5 text-[14px] font-bold">足しました</span>}
                  </th>
                  {routines.map((rt) => {
                    const row = sheetRowFor(state, r.id, rt.routineId);
                    const state3 = row?.skip ? "skip" : row?.startMin !== undefined ? "changed" : "standard";
                    const spoken =
                      state3 === "skip" ? "なし" : state3 === "changed" ? `${clockLabel(row!.startMin!)}（変更）` : `標準どおり ${clockLabel(rt.startMin)}`;
                    return (
                      <td key={rt.routineId} className="border-l border-[var(--cn-grid)] p-1">
                        <button
                          type="button"
                          data-cell={`${r.id}:${rt.routineId}`}
                          data-state={state3}
                          onClick={(e) => openCell(e, r.id, rt)}
                          aria-label={`${r.surname}様 ${rt.name} ${spoken}`}
                          className="flex h-[44px] w-full items-center rounded-lg px-2 text-left hover:bg-[var(--cn-ground)]"
                        >
                          {state3 === "standard" && <span className="text-[var(--cn-muted)]">—</span>}
                          {state3 === "changed" && <strong className="text-[16px]">{clockLabel(row!.startMin!)}</strong>}
                          {state3 === "skip" && <span className="rounded border border-[var(--cn-card-line)] bg-[var(--cn-ground)] px-1.5">なし</span>}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {routines.length === 0 && (
              <tr>
                <td colSpan={2} className="p-4 text-[var(--cn-ink-soft)]">
                  この時間帯の日課はありません。「すべて」で全部の列を出せます。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {routinePanel && (
        <RoutinePanel state={state} groupId={groupId} groupName={groupName} todayLabel={todayLabel} target={routinePanel} onDecide={decideRoutine} onClose={() => setRoutinePanel(null)} />
      )}
      {panel && <CellPanel key={`${panel.routine.routineId}-${panel.residentIds.join(",")}`} target={panel} onDecide={decide} onClose={() => setPanel(null)} />}
    </section>
  );
}
