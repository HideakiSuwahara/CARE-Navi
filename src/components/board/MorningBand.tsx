"use client";

import { useMemo, useState } from "react";
import { useEngine } from "@/store/react";
import { createDayEvents, isFirstTimeDefault, morningDraft, suggestSlot } from "@/domain/pattern";
import { fmtRange } from "@/domain/time";
import type { DateKey, ID, RosterEntry, State } from "@/domain/types";

function shortDate(date: DateKey): string {
  const [, m, d] = date.split("-").map(Number);
  return `${m}/${d}`;
}

/**
 * その日の時間割が空のとき、ボードの上に出す帯（決定記録 0003 §2）。
 * 先週の同じ曜日の番と、曜日の業務表が入っている。違うところだけ直して「この内容で作る」1タップ。
 * 直せること: 休み（1タップ）、番を替える（選ぶ）、今日来る人を足す（名前と番を選ぶ。スポットは初回の印が付く）。
 */
export function MorningBand({ state, date }: { state: State; date: DateKey }) {
  const engine = useEngine();
  const draft = useMemo(() => {
    let n = 0;
    return morningDraft(state, date, () => `draft-${date}-${++n}`);
  }, [state, date]);
  const [rows, setRows] = useState<RosterEntry[]>(draft.entries);
  const [patternId, setPatternId] = useState<ID | undefined>(draft.patternId);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const patterns = Object.values(state.patterns);
  const slots = Object.values(state.roleSlots).sort((a, b) => a.sortOrder - b.sortOrder);
  const notListed = Object.values(state.staff).filter((s) => !rows.some((r) => r.staffId === s.id));

  const update = (id: ID, patch: Partial<RosterEntry>) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const setSlot = (id: ID, slotId: ID) => {
    const slot = state.roleSlots[slotId];
    update(id, { slotId, ...(slot ? { startMin: slot.defaultStartMin, endMin: slot.defaultEndMin } : {}) });
  };

  const addPerson = (staffId: ID) => {
    const staff = state.staff[staffId];
    if (!staff) return;
    // 既定の番: 職種の言葉を含む番だけ（看護・介護助手・スポット）。ほかは人が選ぶ
    const slot = suggestSlot(state, staff.role, new Set(rows.filter((r) => !r.absent && r.slotId).map((r) => r.slotId as ID)));
    const entry: RosterEntry = {
      id: `draft-${date}-add-${staffId}`,
      date,
      staffId,
      slotId: slot?.id,
      startMin: slot?.defaultStartMin ?? 540,
      endMin: slot?.defaultEndMin ?? 1080,
      firstTimer: isFirstTimeDefault(state, staffId, date),
      absent: false,
    };
    setRows((prev) => [...prev, entry]);
    setAdding(false);
  };

  const create = async () => {
    if (!engine || busy) return;
    setBusy(true);
    const events = createDayEvents(engine.state, { ...draft, entries: rows, patternId }, engine.context());
    await engine.dispatch(events, "今日の時間割を作りました");
    setBusy(false);
    // 帯が消えるので、フォーカスを時間割の見出しへ移す（キーボード・読み上げの人が迷わないように）
    requestAnimationFrame(() => document.getElementById("board-title")?.focus());
  };

  // 過去に一度も出ていない人には、職種を問わず「初回」の印を出せる（押して外せる既定。属性では決めない）
  const hasPast = (staffId: ID) => Object.values(state.roster).some((r) => r.staffId === staffId && r.date < date && !r.absent);
  return (
    <section aria-labelledby="morning-title" className="flex flex-col gap-4 overflow-auto p-5">
      <div>
        <h2 id="morning-title" className="text-[20px] font-bold">
          今日の時間割を作る
        </h2>
        {draft.source === "lastWeek" && (
          <p className="mt-1 text-[15px] text-[var(--cn-ink-soft)]">
            先週の同じ曜日（{shortDate(draft.fromDate ?? date)}）と同じ番で並べました。違うところだけ直してください。
          </p>
        )}
        {draft.source === "recent" && (
          <p className="mt-1 text-[15px] text-[var(--cn-ink-soft)]">
            {shortDate(draft.fromDate ?? date)}と同じ番で並べました。勤務表と違うところだけ直してください。
            {draft.afterNight && draft.afterNight.length > 0 && "前の日に夜勤だった人は明けなので休みにしています。今日の夜勤の番は、来る人を選び直してください。"}
          </p>
        )}
        {draft.source === "today" && (
          <p className="mt-1 text-[15px] text-[var(--cn-ink-soft)]">
            勤務表どおり（{shortDate(date)}）に並べました。違うところだけ直してください。
          </p>
        )}
        {draft.source === "none" && (
          <p className="mt-1 text-[15px] text-[var(--cn-ink-soft)]">
            はじめての日です。職員を全員「休み」で並べました。今日来る人の「出勤にする」を押し、番（早番A など、その日の役割）を選んでください。看護・介護助手・スポットの番は仮に入れています。業務表（その曜日の仕事の並び）は下で選べます。
          </p>
        )}
      </div>

      <ul aria-label="今日の出勤者" className="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-2">
        {rows.map((e) => {
          const staff = state.staff[e.staffId];
          return (
            <li
              key={e.id}
              className={`flex min-h-[64px] items-center gap-2 rounded-[10px] border px-3 py-2 ${
                e.absent ? "border-[var(--cn-border)] bg-[var(--cn-ground)] text-[var(--cn-muted)]" : "border-[var(--cn-card-line)] bg-white"
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="shrink-0 font-bold">{staff?.surname}</span>
                  {!e.absent && (e.firstTimer || staff?.role === "スポット" || !hasPast(e.staffId)) && (
                    <button
                      type="button"
                      aria-pressed={e.firstTimer}
                      onClick={() => update(e.id, { firstTimer: !e.firstTimer })}
                      className={`h-[44px] shrink-0 rounded border px-1.5 text-[13px] ${e.firstTimer ? "border-[var(--cn-ink)] font-bold" : "border-[var(--cn-card-line)] text-[var(--cn-muted)]"}`}
                      title="初回の印（押すと外せます）"
                    >
                      初回
                    </button>
                  )}
                  {e.absent ? (
                    <span className="text-[14px]">休み</span>
                  ) : (
                    <select
                      aria-label={`${staff?.surname} の番`}
                      value={e.slotId ?? ""}
                      onChange={(ev) => setSlot(e.id, ev.target.value)}
                      aria-invalid={!e.slotId || undefined}
                      className={`h-[44px] min-w-0 flex-1 rounded-lg border bg-white px-2 text-[15px] ${e.slotId ? "border-[var(--cn-control-line)]" : "border-2 border-[var(--cn-alert-line)]"}`}
                    >
                      {!e.slotId && (
                        <option value="" disabled>
                          番を選ぶ
                        </option>
                      )}
                      {slots.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                {!e.absent && <div className="mt-0.5 text-[13px] text-[var(--cn-muted)]">{fmtRange(e.startMin, e.endMin)}</div>}
              </div>
              <button
                type="button"
                onClick={() => update(e.id, { absent: !e.absent })}
                className={`h-[44px] shrink-0 rounded-lg border px-3 text-[14px] ${
                  e.absent ? "border-[var(--cn-ink)] bg-white font-bold text-[var(--cn-ink)]" : "border-[var(--cn-control-line)] bg-white text-[var(--cn-ink-soft)]"
                }`}
              >
                {e.absent ? (draft.source === "lastWeek" ? "出勤に戻す" : "出勤にする") : "休み"}
              </button>
            </li>
          );
        })}
        <li className="flex min-h-[64px] items-center rounded-[10px] border border-dashed border-[var(--cn-muted)] bg-white px-3 py-2">
          {adding ? (
            <select
              autoFocus
              aria-label="今日来る人を選ぶ"
              defaultValue=""
              onChange={(ev) => ev.target.value && addPerson(ev.target.value)}
              onBlur={() => setAdding(false)}
              className="h-[44px] w-full rounded-lg border border-[var(--cn-control-line)] bg-white px-2 text-[15px]"
            >
              <option value="" disabled>
                名前を選ぶ
              </option>
              {notListed.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.surname}（{s.role}）
                </option>
              ))}
            </select>
          ) : (
            <button type="button" onClick={() => setAdding(true)} disabled={notListed.length === 0} className="h-[44px] w-full text-left text-[15px] disabled:opacity-50">
              ＋ 今日来る人を足す
            </button>
          )}
        </li>
      </ul>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[15px]">
          業務表
          <select
            value={patternId ?? ""}
            onChange={(ev) => setPatternId(ev.target.value || undefined)}
            className="h-[44px] rounded-lg border border-[var(--cn-control-line)] bg-white px-3 text-[15px]"
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
          disabled={!patternId || rows.filter((r) => !r.absent).length === 0 || rows.some((r) => !r.absent && !r.slotId) || busy}
          className="h-[56px] rounded-xl bg-[var(--cn-accent)] px-8 text-[17px] font-bold text-white disabled:opacity-50"
        >
          この内容で作る
        </button>
        <span className="text-[14px] text-[var(--cn-muted)]">
          {rows.some((r) => !r.absent && !r.slotId) ? "番を選んでいない人がいます（赤い枠）。" : "作ったあとで直せます。元に戻すこともできます。"}
        </span>
      </div>
    </section>
  );
}
