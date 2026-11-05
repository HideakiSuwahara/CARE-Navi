"use client";

import { useMemo, useState } from "react";
import { parseRosterPaste, rosterPasteEvents, rosterPasteLabel, shortDay, type CellMapping } from "@/domain/rosterPaste";
import type { State } from "@/domain/types";
import { useEngine } from "@/store/react";

/**
 * 勤務表の貼り付け（月）。決定記録 0015。
 * Excel の表（1 行目が日付、1 列目が名前、セルが番の略称）を貼る → 日付ごとの出勤者と番。
 * 照らせない略称は、ここで 1 回だけ番（または休み）を選ぶ。同じ日を貼り直すと置き換える。
 */
export function RosterPaste({ state, today, onDone }: { state: State; today: string; onDone: (label: string) => void }) {
  const engine = useEngine();
  const now = new Date();
  const [ym, setYm] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [text, setText] = useState("");
  const [aliases, setAliases] = useState<Record<string, CellMapping>>({});
  const [year, month] = ym.split("-").map(Number);
  const parsed = useMemo(() => parseRosterPaste(state, text, { year, month, aliases, today: today || undefined }), [state, text, year, month, aliases, today]);
  const others = Object.keys(state.staff).length - parsed.staffIds.length;
  const slots = Object.values(state.roleSlots).sort((a, b) => a.sortOrder - b.sortOrder);
  const canApply = parsed.errors.length === 0 && parsed.unknownCells.length === 0 && parsed.cells.length > 0;
  const field = "h-[44px] rounded-lg border border-[var(--cn-control-line)] px-2.5 text-[15px]";

  const apply = async () => {
    if (!engine || !canApply) return;
    const evs = rosterPasteEvents(engine.state, parsed, engine.context());
    if (evs.length === 0) return;
    const label = rosterPasteLabel(parsed);
    await engine.dispatch(evs, label);
    setText("");
    setAliases({});
    onDone(label);
  };

  return (
    <section aria-labelledby="s-roster" className="rounded-xl border border-[var(--cn-border)] bg-white p-4">
      <h3 id="s-roster" className="mb-1 text-[16px] font-bold">
        月の勤務表を貼り付ける
      </h3>
      <p className="mb-2 text-[14px] text-[var(--cn-ink-soft)]">
        Excel の勤務表を、日付の行から下をそのままコピーして貼ります。日付の行（1, 2, 3… か 11/1）、名前の列、マスが番の略称（早A・日B・遅・夜勤東 など）。
        「休」「公休」「明」「有休」「/」「－」と空のマスは休みにします（明けの人は前の日の夜勤として残ります）。21 日〜翌 20 日の表も読めます。
        入れた日は、ボードの朝の帯がその番で並びます（直すのはその日の帯で）。同じ日を貼り直すと置き換えます。表にない職員と、今日より前の日は変えません。
        画像や PDF は読みません（表をコピーしてください）。
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[14px]">
          何月の勤務表ですか（表の最初の日の月）
          <input type="month" value={ym} onChange={(e) => setYm(e.target.value)} className={`${field} w-[180px]`} />
        </label>
        <span className="pb-3 text-[14px] text-[var(--cn-muted)]">日付の行が 11/1 のように月入りなら、そちらを使います。</span>
      </div>
      <label htmlFor="s-roster-text" className="mt-2 mb-1 block font-bold">
        勤務表
      </label>
      <textarea
        id="s-roster-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        className="w-full rounded-lg border border-[var(--cn-control-line)] p-2.5 font-mono text-[14px] placeholder:text-[var(--cn-muted)]"
        placeholder={"氏名\t1\t2\t3\n佐藤\t早A\t休\t夜勤東\n高橋\t日B\t早B\t休"}
      />
      {text.trim() && (
        <div className="mt-2 flex flex-col gap-2 text-[14px]" aria-live="polite">
          {parsed.errors.map((e) => (
            <p key={e} className="text-[var(--cn-unassigned-ink)]">
              {e}
            </p>
          ))}
          {parsed.dates.length > 0 && (
            <p className="font-bold">
              {Number(parsed.dates[0].slice(5, 7))}/{Number(parsed.dates[0].slice(8, 10))}〜{Number(parsed.dates[parsed.dates.length - 1].slice(5, 7))}/
              {Number(parsed.dates[parsed.dates.length - 1].slice(8, 10))} の {parsed.dates.length} 日・{parsed.staffIds.length} 人を入れられます
            </p>
          )}
          {parsed.dates.length > 0 && parsed.readMappings.length > 0 && (
            <p>読んだ対応: {parsed.readMappings.map((m) => `${m.cell}→${m.slotName}`).join("・")}</p>
          )}
          {parsed.dates.length > 0 && parsed.offCellsSeen.length > 0 && <p>休みとして読んだ印: {parsed.offCellsSeen.join("・")}</p>}
          {parsed.dates.length > 0 && others > 0 && <p>ほかの {others} 人は今のまま（この表にない人は変えません）。</p>}
          {parsed.skippedEmptyDates.length > 0 && (
            <p>
              空欄だけの日 {parsed.skippedEmptyDates.length} 日（{shortDay(parsed.skippedEmptyDates[0])}〜）は入れません（未記入のまま全員を休みにしないため）。
            </p>
          )}
          {parsed.skippedPastDates.length > 0 && <p>今日より前の {parsed.skippedPastDates.length} 日は変えません。</p>}
          {parsed.unmatchedNames.length > 0 && (
            <p className="text-[var(--cn-unassigned-ink)]">
              名簿と照らせない名前（この行は入れません）: {parsed.unmatchedNames.map((u) => `${u.name}（${u.line} 行目）`).join("・")}。
              職員なら上の「職員」で足すか、名簿と同じ書き方にしてください（同じ姓が 2 人いるときは姓と名で）。曜日・合計の行は気にしなくて構いません。
            </p>
          )}
          {parsed.errors.length === 0 && parsed.staffIds.length === 0 && <p className="text-[var(--cn-unassigned-ink)]">入れられる人がいません。先に「職員」で足してください。</p>}
          {parsed.unknownCells.length > 0 && (
            <fieldset className="rounded-lg border border-[var(--cn-control-line)] p-3">
              <legend className="px-1 font-bold">この略称はどの番ですか（1 回選ぶと、この表の全部に効きます）</legend>
              <ul className="flex flex-col gap-2">
                {parsed.unknownCells.map((c) => (
                  <li key={c} className="flex flex-wrap items-center gap-2">
                    <span className="w-[120px] font-bold">「{c}」</span>
                    <select
                      aria-label={`「${c}」の番`}
                      value={aliases[c] ?? ""}
                      onChange={(e) => setAliases((a) => ({ ...a, [c]: e.target.value as CellMapping }))}
                      className={`${field} w-[220px]`}
                    >
                      <option value="" disabled>
                        番を選ぶ
                      </option>
                      {slots.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                      <option value="off">休み</option>
                    </select>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button type="button" disabled={!canApply} onClick={apply} className="h-[44px] rounded-lg bg-[var(--cn-accent)] px-4 font-bold text-white disabled:bg-[var(--cn-muted)]">
          この内容で入れる
        </button>
        {text.trim() && parsed.unknownCells.length > 0 && (
          <span className="text-[14px] text-[var(--cn-ink-soft)]">{parsed.unknownCells.map((c) => `「${c}」`).join("")}の番を選ぶと押せます。</span>
        )}
      </div>
    </section>
  );
}
