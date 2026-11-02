"use client";

import { useMemo, useState } from "react";
import { useEngine } from "@/store/react";
import { createDayEvents, morningDraft } from "@/domain/pattern";
import { fmtRange } from "@/domain/time";
import type { DateKey, ID, State } from "@/domain/types";

function shortDate(date: DateKey): string {
  const [, m, d] = date.split("-").map(Number);
  return `${m}/${d}`;
}

/**
 * その日の時間割が空のとき、ボードの上に出す帯（決定記録 0003 §2）。
 * 先週の同じ曜日の番と、曜日の業務表が入っている。違うところだけ直して「この内容で作る」1タップ。
 */
export function MorningBand({ state, date }: { state: State; date: DateKey }) {
  const engine = useEngine();
  const draft = useMemo(() => {
    let n = 0;
    return morningDraft(state, date, () => `draft-${date}-${++n}`);
  }, [state, date]);
  const [off, setOff] = useState<Set<ID>>(new Set());
  const [patternId, setPatternId] = useState<ID | undefined>(draft.patternId);
  const [busy, setBusy] = useState(false);
  const patterns = Object.values(state.patterns);

  const create = async () => {
    if (!engine || busy) return;
    setBusy(true);
    const entries = draft.entries.map((e) => (off.has(e.id) ? { ...e, absent: true } : e));
    const events = createDayEvents(engine.state, { ...draft, entries, patternId }, engine.context());
    await engine.dispatch(events, "今日の時間割を作りました");
    setBusy(false);
  };

  return (
    <section aria-labelledby="morning-title" className="flex flex-col gap-4 p-5">
      <div>
        <h2 id="morning-title" className="text-[20px] font-bold">
          今日の時間割を作る
        </h2>
        {draft.source === "lastWeek" && (
          <p className="mt-1 text-[15px] text-[var(--cn-ink-soft)]">
            先週の同じ曜日（{shortDate(draft.entries[0]?.carriedFrom ?? date)}）と同じ番で並べました。休みの人だけ外してください。
          </p>
        )}
        {draft.source === "none" && <p className="mt-1 text-[15px] text-[var(--cn-ink-soft)]">出勤者がまだいません。設定から職員を登録してください。</p>}
      </div>

      {draft.entries.length > 0 && (
        <ul aria-label="今日の出勤者" className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2">
          {draft.entries.map((e) => {
            const staff = state.staff[e.staffId];
            const slot = e.slotId ? state.roleSlots[e.slotId] : undefined;
            const isOff = off.has(e.id);
            return (
              <li
                key={e.id}
                className={`flex min-h-[56px] items-center gap-3 rounded-[10px] border px-3 py-2 ${
                  isOff ? "border-[var(--cn-border)] bg-[var(--cn-ground)] text-[var(--cn-muted)]" : "border-[var(--cn-card-line)] bg-white"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-bold">{staff?.surname}</span>
                    <span className="truncate text-[14px]">{isOff ? "休み" : slot?.name}</span>
                  </div>
                  {!isOff && <div className="text-[13px] text-[var(--cn-muted)]">{fmtRange(e.startMin, e.endMin)}</div>}
                </div>
                <button
                  type="button"
                  aria-pressed={isOff}
                  onClick={() =>
                    setOff((prev) => {
                      const next = new Set(prev);
                      if (next.has(e.id)) next.delete(e.id);
                      else next.add(e.id);
                      return next;
                    })
                  }
                  className={`h-[44px] shrink-0 rounded-lg border px-3 text-[14px] ${
                    isOff ? "border-[var(--cn-ink)] bg-[var(--cn-ink)] text-white" : "border-[var(--cn-card-line)] bg-white text-[var(--cn-ink-soft)]"
                  }`}
                >
                  休み
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[15px]">
          業務表
          <select
            value={patternId ?? ""}
            onChange={(ev) => setPatternId(ev.target.value || undefined)}
            className="h-[44px] rounded-lg border border-[var(--cn-card-line)] bg-white px-3 text-[15px]"
          >
            {patterns.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={create}
          disabled={!patternId || draft.entries.length === 0 || busy}
          className="h-[56px] rounded-xl bg-[var(--cn-accent)] px-8 text-[17px] font-bold text-white disabled:opacity-50"
        >
          この内容で作る
        </button>
        <span className="text-[14px] text-[var(--cn-muted)]">作ったあとで直せます。元に戻すこともできます。</span>
      </div>
    </section>
  );
}
