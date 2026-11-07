"use client";

import { useEffect, useRef, useState } from "react";
import { boardName } from "@/domain/checks";
import { monthCellText, monthDates, OFF_KINDS, setMonthCellEvents, type MonthCellChoice } from "@/domain/rosterPaste";
import type { DateKey, ID, State } from "@/domain/types";
import { useEngine } from "@/store/react";

const WEEK = ["日", "月", "火", "水", "木", "金", "土"];

/**
 * 1 か月の勤務の表（決定記録 0024）。行が職員、列が日付、マスに番の名前か休みの種類。
 * マスを押すと、番・休みの種類・「入れていない」を選ぶ。1 マス 1 バッチ、元に戻せる。人ごとの合計は出さない（原則 5）。
 */
export function MonthRoster({ state, today, onDone }: { state: State; today: string; onDone: (label: string) => void }) {
  const engine = useEngine();
  const base = today || new Date().toISOString().slice(0, 10);
  const [ym, setYm] = useState(base.slice(0, 7));
  const [year, month] = ym.split("-").map(Number);
  const dates = monthDates(year, month);
  // 名簿の順（貼り付けた順）
  const staff = Object.values(state.staff);
  const slots = Object.values(state.roleSlots).sort((a, b) => a.sortOrder - b.sortOrder);
  const [cell, setCell] = useState<{ date: DateKey; staffId: ID } | null>(null);
  const pickRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (cell) pickRef.current?.querySelector<HTMLElement>("button")?.focus();
  }, [cell]);
  const shift = (d: number) => {
    const t = new Date(year, month - 1 + d, 1);
    setYm(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}`);
    setCell(null);
  };
  const back = (c: { date: DateKey; staffId: ID }) =>
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-month-cell="${c.date}:${c.staffId}"]`)?.focus());
  const choose = (choice: MonthCellChoice) => {
    if (!engine || !cell) return;
    const r = setMonthCellEvents(engine.state, cell.date, cell.staffId, choice, engine.context());
    if (r.events.length > 0) {
      engine.dispatch(r.events, r.label);
      onDone(r.label);
    }
    const c = cell;
    setCell(null);
    back(c);
  };
  const btn = "inline-flex h-[44px] items-center rounded-lg border border-[var(--cn-control-line)] bg-white px-3 text-[15px]";
  const dow = (d: DateKey) => new Date(`${d}T12:00:00`).getDay();

  return (
    <section aria-labelledby="s-month" className="flex flex-col gap-2 rounded-xl border border-[var(--cn-border)] bg-white p-4">
      <h3 id="s-month" className="text-[16px] font-bold">
        1 か月の勤務
      </h3>
      <p className="text-[14px] text-[var(--cn-ink-soft)]">
        貼り付けた勤務表を職員ごとに確かめ、マスを押して直せます（番・休みの種類・入れていない）。時間割を作ってある日の担当は変わりません（その日はボードの「欠勤・早退」で）。人ごとの合計は出しません。
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => shift(-1)} className={btn}>
          ‹ 前の月
        </button>
        <span className="text-[16px] font-bold" aria-live="polite">
          {year}年{month}月
        </span>
        <button type="button" onClick={() => shift(1)} className={btn}>
          次の月 ›
        </button>
      </div>
      <div className="overflow-auto rounded-lg border border-[var(--cn-border)]" tabIndex={0} role="region" aria-label={`${year}年${month}月の勤務の表`}>
        <table className="border-collapse text-[13px]">
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-10 bg-[var(--cn-ground)] px-2 py-1 text-left">
                職員
              </th>
              {dates.map((d) => (
                <th key={d} scope="col" className={`min-w-[52px] px-1 py-1 text-center font-normal ${d === today ? "bg-[var(--cn-accent-soft)] font-bold" : ""}`}>
                  {Number(d.slice(8))}
                  <span className="block text-[12px] text-[var(--cn-muted)]">{WEEK[dow(d)]}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {staff.map((st) => (
              <tr key={st.id} className="border-t border-[var(--cn-grid)]">
                <th scope="row" className="sticky left-0 z-10 whitespace-nowrap bg-white px-2 text-left font-bold">
                  {boardName(state, st.id)}
                </th>
                {dates.map((d) => {
                  const c = monthCellText(state, d, st.id);
                  return (
                    <td key={d} className="p-0.5">
                      <button
                        type="button"
                        data-month-cell={`${d}:${st.id}`}
                        aria-label={`${Number(d.slice(5, 7))}月${Number(d.slice(8))}日 ${boardName(state, st.id)}さん: ${c.text ? (c.off ? `休み（${c.text}）` : c.text) : "入れていない"}`}
                        aria-expanded={cell?.date === d && cell.staffId === st.id}
                        onClick={() => setCell({ date: d, staffId: st.id })}
                        className={`h-[44px] w-[52px] overflow-hidden break-all rounded px-0.5 text-[12px] leading-tight ${
                          c.off ? "bg-[var(--cn-ground)] text-[var(--cn-ink-soft)]" : c.text ? "border border-[var(--cn-accent)] bg-[var(--cn-accent-soft)] font-bold text-[var(--cn-accent)]" : "border border-dashed border-[var(--cn-control-line)]"
                        }`}
                      >
                        {c.text}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cell && (
        <div
          ref={pickRef}
          role="group"
          aria-labelledby="month-pick-title"
          className="flex flex-col gap-2 rounded-xl border-2 border-[var(--cn-accent)] p-3"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              const c = cell;
              setCell(null);
              back(c);
            }
          }}
        >
          <p id="month-pick-title" className="font-bold">
            {Number(cell.date.slice(5, 7))}月{Number(cell.date.slice(8))}日（{WEEK[dow(cell.date)]}） {boardName(state, cell.staffId)}さん
          </p>
          <div className="flex flex-wrap gap-2">
            {slots.map((sl) => (
              <button key={sl.id} type="button" onClick={() => choose({ kind: "slot", slotId: sl.id })} className={btn}>
                {sl.name}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {OFF_KINDS.map((k) => (
              <button key={k} type="button" onClick={() => choose({ kind: "off", offKind: k })} className={btn}>
                休み（{k}）
              </button>
            ))}
            <button type="button" onClick={() => choose({ kind: "off" })} className={btn}>
              休み
            </button>
            <button type="button" onClick={() => choose({ kind: "none" })} className={btn}>
              入れていない
            </button>
            <button
              type="button"
              onClick={() => {
                const c = cell;
                setCell(null);
                back(c);
              }}
              className={btn}
            >
              やめる
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
