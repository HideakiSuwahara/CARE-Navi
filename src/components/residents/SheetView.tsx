"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { useEngine } from "@/store/react";
import { sheetLines, sheetOf, type SheetLine } from "@/domain/routine";
import {
  SHEET_TEXT_FIELDS,
  dateOfIso,
  extraRowEvent,
  lineStatus,
  removeRowEvent,
  residentsOfGroup,
  routineChangeEvents,
  sheetCsvRows,
  sheetTextEvent,
  type RoutineChange,
  type SheetTextField,
} from "@/domain/residentsIO";
import { alignToSheetDay, clockLabel, parseClockInput } from "@/domain/time";
import type { ID, State } from "@/domain/types";
import { CellPanel, changeLabel, type CellTarget } from "./CellPanel";
import { downloadCsv } from "./download";

/**
 * 24時間シート（一人ずつ、縦に時刻）。施設の日課の行＋その方だけの行。
 * 文章の4項目はその場で書き、フォーカスが外れたら保存する（保存ごとに sheet.upsert）。
 * 書きかけで未保存の間は欄の横に「未保存」と出し、そのまま画面を離れるときは確かめる。
 */
export function SheetView({ state, groupId }: { state: State; groupId: ID }) {
  const residents = useMemo(() => residentsOfGroup(state, groupId), [state, groupId]);
  const [pick, setPick] = useState<ID | null>(null);
  const residentId = pick && state.residents[pick]?.groupId === groupId ? pick : residents[0]?.id;
  const groupName = state.groups[groupId]?.name ?? "";

  if (!residentId) {
    return <p className="p-6 text-[var(--cn-ink-soft)]">{groupName}の利用者はまだいません。右上の「名簿を貼り付ける」から足せます。</p>;
  }

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      <nav aria-label={`${groupName}の利用者`} className="cn-noprint w-[220px] shrink-0 overflow-auto rounded-xl border border-[var(--cn-border)] bg-white p-2">
        <ul className="flex flex-col gap-1">
          {residents.map((r) => {
            const on = r.id === residentId;
            return (
              <li key={r.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => setPick(r.id)}
                  className={`flex min-h-[44px] w-full items-center gap-2 rounded-lg px-3 text-left ${
                    on ? "bg-[var(--cn-accent-soft)] font-bold text-[var(--cn-accent)]" : "text-[var(--cn-ink)] hover:bg-[var(--cn-ground)]"
                  }`}
                >
                  <span className="text-[14px] font-normal text-[var(--cn-muted)]">{r.room}</span>
                  <span>{r.displayName}様</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      <Sheet key={residentId} state={state} residentId={residentId} />
    </div>
  );
}

function Sheet({ state, residentId }: { state: State; residentId: ID }) {
  const engine = useEngine();
  const resident = state.residents[residentId]!;
  const group = state.groups[resident.groupId]?.name ?? "";
  const sheet = sheetOf(state, residentId);
  const lines = useMemo(() => sheetLines(state, residentId), [state, residentId]);
  const [panel, setPanel] = useState<CellTarget | null>(null);
  const [adding, setAdding] = useState(false);
  const who = `${resident.surname}様`;

  const decide = (c: RoutineChange) => {
    if (!engine || !panel) return;
    const events = routineChangeEvents(engine.state, engine.context(), panel.residentIds, panel.routine, c);
    const label = changeLabel(panel.who, panel.routine, c);
    setPanel(null);
    if (events.length > 0) void engine.dispatch(events, label);
  };

  const saveText = (line: SheetLine, field: SheetTextField, label: string, value: string) => {
    if (!engine) return;
    const ev = sheetTextEvent(engine.state, engine.context(), residentId, line, field, value);
    if (ev) void engine.dispatch([ev], `${who}の「${line.name}」の${label}を保存しました`);
  };

  return (
    <section aria-label={`${resident.displayName}様の24時間シート`} className="cn-sheet min-h-0 min-w-0 flex-1 overflow-auto rounded-xl border border-[var(--cn-border)] bg-white p-4">
      <style>{"@media print { @page { size: A4 portrait; margin: 12mm; } .cn-sheet { overflow: visible !important; border: 0 !important; padding: 0 !important; } }"}</style>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
        <h2 className="text-[20px] font-bold">{resident.displayName}様の24時間シート</h2>
        <span className="text-[15px]">{resident.room}号室</span>
        <span className="text-[15px]">{group}</span>
        <span className="text-[14px] text-[var(--cn-muted)]">更新日 {dateOfIso(sheet.updatedAt)}</span>
        <span className="hidden text-[14px] print:inline">作成日 {dateOfIso(new Date().toISOString())}</span>
        <span className="hidden text-[14px] print:inline">記入者：＿＿＿＿＿＿＿＿</span>
        <div className="cn-noprint ml-auto flex gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex h-[44px] items-center rounded-lg border border-[var(--cn-control-line)] bg-white px-4 text-[15px]"
          >
            印刷
          </button>
          <button
            type="button"
            onClick={() => downloadCsv(`24時間シート_${resident.room}_${resident.surname}.csv`, sheetCsvRows(state, residentId))}
            className="inline-flex h-[44px] items-center rounded-lg border border-[var(--cn-control-line)] bg-white px-4 text-[15px]"
          >
            CSV
          </button>
        </div>
      </div>
      <p className="cn-noprint mt-1 text-[14px] text-[var(--cn-ink-soft)]">
        時刻を押すとこの方だけ直せます。文章は書いて欄の外を押すと保存します。サポートが必要なことは、その業務の担当の人の手元に出ます。
      </p>

      <table className="mt-3 w-full border-collapse text-[15px]">
        <thead>
          <tr className="border-b-2 border-[var(--cn-card-line)] text-left">
            <th scope="col" className="w-[128px] px-2 py-2">時刻</th>
            <th scope="col" className="w-[150px] px-2 py-2">生活の流れ</th>
            {SHEET_TEXT_FIELDS.map((f) => (
              <th key={f.field} scope="col" className="px-2 py-2">
                {f.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.key} data-line={line.key} data-kind={line.kind} className="break-inside-avoid border-b border-[var(--cn-grid)] align-top">
              <td className="px-1 py-1">
                <TimeCell
                  line={line}
                  onOpen={(anchor) =>
                    line.routine &&
                    setPanel({ who, residentIds: [residentId], routine: line.routine, startMin: line.startMin, anchor })
                  }
                  onRemove={() => {
                    if (!engine || !line.row) return;
                    void engine.dispatch([removeRowEvent(state, engine.context(), residentId, line.row.id)], `${who}の「${line.name}」の行を消しました`);
                  }}
                />
              </td>
              <td className="px-2 py-2">
                <span className={line.kind === "skipped" ? "text-[var(--cn-muted)] line-through" : "font-bold"}>{line.name}</span>
              </td>
              {SHEET_TEXT_FIELDS.map((f) => {
                const value = line.row?.[f.field] ?? "";
                return (
                  <td key={f.field} className="px-1 py-1">
                    <TextField
                      key={`${line.key}-${value}`}
                      saved={value}
                      label={`${clockLabel(line.startMin)} ${line.name} の${f.label}`}
                      onSave={(v) => saveText(line, f.field, f.label, v)}
                    />
                    <span className="hidden whitespace-pre-wrap px-1 print:block">{value}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="cn-noprint mt-3 flex flex-col items-start gap-2 pb-[96px]">
        <button
          type="button"
          aria-expanded={adding}
          onClick={() => setAdding((v) => !v)}
          className="inline-flex h-[44px] items-center rounded-lg border border-dashed border-[var(--cn-control-line)] bg-white px-4 text-[15px]"
        >
          ＋ この方だけの行を足す
        </button>
        {adding && (
          <ExtraRowForm
            state={state}
            onCancel={() => setAdding(false)}
            onDecide={(input) => {
              if (!engine) return;
              setAdding(false);
              const ev = extraRowEvent(state, engine.context(), residentId, input);
              void engine.dispatch([ev], `${who}だけの「${input.label || state.templates[input.templateId ?? ""]?.name || ""}」を ${clockLabel(input.startMin)} に足しました`);
            }}
          />
        )}
      </div>
      {panel && <CellPanel key={panel.routine.routineId} target={panel} onDecide={decide} onClose={() => setPanel(null)} />}
    </section>
  );
}

function TimeCell({ line, onOpen, onRemove }: { line: SheetLine; onOpen: (anchor: DOMRect) => void; onRemove: () => void }) {
  const status = lineStatus(line);
  if (line.kind === "extra") {
    return (
      <div className="flex flex-col items-start px-1 py-1">
        <span className="font-bold">{clockLabel(line.startMin)}</span>
        <span className="text-[14px]">{status}</span>
        <button type="button" onClick={onRemove} className="cn-noprint h-[44px] text-[14px] text-[var(--cn-ink-soft)] underline" aria-label={`${line.name}の行を消す`}>
          この行を消す
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => onOpen(e.currentTarget.getBoundingClientRect())}
      aria-label={`${line.name} ${line.kind === "skipped" ? "この方はなし" : `${clockLabel(line.startMin)} ${status}`}。押すと時刻を直す`}
      className="flex min-h-[44px] w-full flex-col items-start rounded-lg px-1 py-1 text-left hover:bg-[var(--cn-ground)]"
    >
      {line.kind === "skipped" ? (
        <span className="text-[14px] font-bold">{status}</span>
      ) : (
        <>
          <span className={line.kind === "changed" ? "text-[16px] font-bold" : "text-[var(--cn-muted)]"}>{clockLabel(line.startMin)}</span>
          <span className={`text-[14px] ${line.kind === "changed" ? "font-bold" : "text-[var(--cn-muted)]"}`}>{status}</span>
        </>
      )}
    </button>
  );
}

function ExtraRowForm({
  state,
  onDecide,
  onCancel,
}: {
  state: State;
  onDecide: (input: { startMin: number; label: string; templateId?: ID }) => void;
  onCancel: () => void;
}) {
  const [time, setTime] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const timeInput = useRef<HTMLInputElement>(null);
  // 押したボタンのすぐ下に開き、画面下のお知らせに隠れない位置までスクロールする
  useEffect(() => {
    form.current?.scrollIntoView({ block: "center" });
    timeInput.current?.focus();
  }, []);
  const [label, setLabel] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const templates = Object.values(state.templates)
    .filter((t) => t.kind !== "break" && t.targetMode !== "none")
    .sort((a, b) => a.name.localeCompare(b.name, "ja"));
  const field = "h-[44px] rounded-lg border border-[var(--cn-control-line)] bg-white px-2 text-[15px]";

  return (
    <form
      ref={form}
      aria-label="この方だけの行を足す"
      className="flex flex-wrap items-end gap-3 rounded-xl border border-[var(--cn-card-line)] bg-[var(--cn-ground)] p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!time.trim()) return setError("時刻を入れると決定できます");
        const m = parseClockInput(time);
        if (m === null) return setError("時刻は 10:00 か 1000 のように入れてください");
        if (!label.trim() && !templateId) return setError("名前を入れるか、業務の種類を選んでください");
        onDecide({ startMin: alignToSheetDay(m), label, templateId: templateId || undefined });
      }}
    >
      <label className="flex flex-col gap-1 text-[14px]">
        時刻
        <input
          ref={timeInput}
          value={time}
          onChange={(e) => {
            setTime(e.target.value);
            setError(null);
          }}
          placeholder="例: 10:00"
          aria-describedby={time.trim() ? undefined : "extra-row-time-hint"}
          className={`${field} w-[110px]`}
        />
      </label>
      <label className="flex flex-col gap-1 text-[14px]">
        名前
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="例: 新聞を読む" className={`${field} w-[200px]`} />
      </label>
      <label className="flex flex-col gap-1 text-[14px]">
        業務の種類（任意）
        <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={`${field} w-[220px]`}>
          <option value="">選ばない（シートにだけ出す）</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={!time.trim()}
        className="inline-flex h-[44px] items-center rounded-lg bg-[var(--cn-accent)] px-4 font-bold text-white disabled:cursor-not-allowed disabled:bg-[var(--cn-muted)]"
      >
        この内容で決定
      </button>
      <button type="button" onClick={onCancel} className="inline-flex h-[44px] items-center rounded-lg px-3 text-[15px] text-[var(--cn-ink-soft)] underline">
        やめる
      </button>
      {!time.trim() && (
        <p id="extra-row-time-hint" className="w-full text-[14px] font-bold">
          時刻を入れると決定できます。
        </p>
      )}
      <p className="w-full text-[14px] text-[var(--cn-ink-soft)]">業務の種類を選ぶと、次に時間割を作るときから、この方の枠ができます。</p>
      {error && (
        <p role="alert" className="w-full text-[14px] font-bold text-[var(--cn-unassigned-ink)]">
          {error}
        </p>
      )}
    </form>
  );
}

/** 24時間シートの文章欄。書きかけで未保存の間は「未保存」と出し、画面を離れるときに確かめる */
function TextField({ saved, label, onSave }: { saved: string; label: string; onSave: (value: string) => void }) {
  const [value, setValue] = useState(saved);
  const dirty = value.trim() !== saved.trim();
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // 古いブラウザは returnValue に文字があるときだけ確認を出す
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
  return (
    <div className="flex items-start gap-1 print:hidden">
      <textarea
        value={value}
        rows={2}
        aria-label={label}
        onChange={(e) => setValue(e.currentTarget.value)}
        onBlur={(e) => onSave(e.currentTarget.value)}
        className="block min-h-[44px] w-full min-w-[140px] resize-y [field-sizing:content] rounded-md border border-[var(--cn-border)] px-2 py-1.5 text-[15px] hover:border-[var(--cn-control-line)] focus:border-[var(--cn-control-line)]"
      />
      {dirty && (
        <span data-unsaved="true" className="shrink-0 whitespace-nowrap rounded border border-[var(--cn-short-ink)] bg-[var(--cn-short-bg)] px-1 text-[14px] font-bold text-[var(--cn-short-ink)]">
          未保存
        </span>
      )}
    </div>
  );
}
