"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { defaultRoutineHeadcount, routineHeadcount, type Routine } from "@/domain/routine";
import { alignToReference, clockLabel, parseClockInput } from "@/domain/time";
import type { ID, State } from "@/domain/types";

export type RoutinePanelTarget =
  | { mode: "add"; anchor: DOMRect }
  | { mode: "edit"; routine: Routine; anchor: DOMRect };

export type RoutinePanelResult =
  | { kind: "add"; templateId: ID; startMin: number; endMin: number; headcount: number; today: boolean }
  | { kind: "retime"; startMin: number; endMin: number; headcount: number }
  | { kind: "remove" };

/**
 * 施設の日課を足す／標準の時刻を変える／やめる小さなパネル（決定記録 0013）。
 * 足す: 業務の種類・開始・終わり（終わりの既定は業務の種類の標準の長さ）→「この内容で決定」。
 */
export function RoutinePanel({
  state,
  groupId,
  groupName,
  target,
  todayLabel,
  onDecide,
  onClose,
}: {
  state: State;
  groupId: ID;
  groupName: string;
  /** 今日の時間割がもうできていれば、その日付（「11/5」）。足すときに今日にも入れるかを選べる */
  todayLabel?: string;
  target: RoutinePanelTarget;
  onDecide: (r: RoutinePanelResult) => void;
  onClose: () => void;
}) {
  const templates = Object.values(state.templates)
    .filter((t) => t.kind !== "break")
    .sort((a, b) => a.name.localeCompare(b.name, "ja"));
  const editing = target.mode === "edit" ? target.routine : null;
  const [templateId, setTemplateId] = useState<ID>(editing?.templateId ?? "");
  const [startText, setStartText] = useState(editing ? clockLabel(editing.startMin) : "");
  const [endText, setEndText] = useState(editing ? clockLabel(editing.endMin) : "");
  const [endTouched, setEndTouched] = useState(Boolean(editing));
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<"template" | "start" | "end" | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  // 必要人数（施設が決める予定値）。足すときは、同じ業務のいちばん近い日課の人数を既定にする（人が直したら触らない）
  const [headcount, setHeadcount] = useState<number>(editing ? (routineHeadcount(state, editing.routineId) ?? 1) : 1);
  const [headcountTouched, setHeadcountTouched] = useState(Boolean(editing));
  const [today, setToday] = useState(true);
  const first = useRef<HTMLSelectElement & HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: target.anchor.bottom + 4, left: target.anchor.left });

  useEffect(() => {
    first.current?.focus();
  }, []);
  useLayoutEffect(() => {
    const el = panel.current;
    if (!el) return;
    let top = target.anchor.bottom + 4;
    if (top + el.offsetHeight > window.innerHeight - 8) top = Math.max(8, target.anchor.top - el.offsetHeight - 4);
    const left = Math.min(Math.max(8, target.anchor.left), window.innerWidth - el.offsetWidth - 8);
    setPos({ top, left });
  }, [target.anchor]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      // aria-modal なので、Tab をパネルの中にとどめる（Sheet と同じ）
      if (e.key !== "Tab" || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled])")];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const tpl = templateId ? state.templates[templateId] : undefined;
  // 時刻を一日（5:00〜翌5:00）の分に読む。変えるときは、いまの標準にいちばん近い日に合わせる
  const readStart = (text: string) => {
    const m = parseClockInput(text);
    if (m === null) return null;
    if (editing) return alignToReference(m, editing.startMin);
    // ボードの一日（6:00〜翌6:00）に合わせる。6:00 より前は翌朝（夜勤の受け持ち）
    const base = ((m % (24 * 60)) + 24 * 60) % (24 * 60);
    return base < 6 * 60 ? base + 24 * 60 : base;
  };
  const readEnd = (text: string, start: number) => {
    const m = parseClockInput(text);
    if (m === null) return null;
    // 開始より後で、いちばん近い時刻（「23:30–0:30」は翌0:30）
    const base = ((m % (24 * 60)) + 24 * 60) % (24 * 60);
    return [base, base + 24 * 60, base + 48 * 60].find((c) => c > start) ?? null;
  };

  // 開始を入れたら、終わりを業務の種類の標準の長さで埋める（人が直したら触らない）
  const suggestHeadcount = (id: ID, start: number | null) => {
    if (headcountTouched || !id) return;
    setHeadcount(defaultRoutineHeadcount(state, groupId, id, start ?? 12 * 60));
  };
  const onStart = (text: string) => {
    setStartText(text);
    setError(null);
    setErrorField(null);
    if (!editing) suggestHeadcount(templateId, readStart(text));
    if (endTouched) return;
    const s = readStart(text);
    const length = editing ? editing.endMin - editing.startMin : tpl?.defaultDurationMin;
    if (s !== null && length) setEndText(clockLabel(s + length));
  };
  const onTemplate = (id: ID) => {
    setTemplateId(id);
    setError(null);
    setErrorField(null);
    const s = readStart(startText);
    suggestHeadcount(id, s);
    const t = state.templates[id];
    if (!endTouched && s !== null && t) setEndText(clockLabel(s + t.defaultDurationMin));
  };

  const decide = () => {
    const fail = (field: "template" | "start" | "end", text: string) => {
      setError(text);
      setErrorField(field);
    };
    if (!editing && !tpl) return fail("template", "業務の種類を選んでください");
    const s = readStart(startText);
    if (s === null) return fail("start", "開始は 13:30 か 1330 のように入れてください");
    const e = readEnd(endText, s);
    if (e === null || e <= s) return fail("end", "終わりは開始より後の時刻を入れてください");
    if (editing) onDecide({ kind: "retime", startMin: s, endMin: e, headcount });
    else onDecide({ kind: "add", templateId: tpl!.id, startMin: s, endMin: e, headcount, today: Boolean(todayLabel) && today });
  };

  const input = "h-[44px] rounded-lg border border-[var(--cn-control-line)] bg-white px-2 text-[16px]";
  const title = editing ? `${groupName}の${editing.name}（標準の時刻）` : `${groupName}に日課を足す`;

  return (
    <>
      <div className="fixed inset-0 z-40" aria-hidden="true" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fixed z-50 w-[360px] rounded-xl border border-[var(--cn-card-line)] bg-white p-4 shadow-xl"
        style={{ top: pos.top, left: pos.left }}
      >
        <p className="font-bold">{title}</p>
        <p className="text-[14px] text-[var(--cn-ink-soft)]">
          {editing
            ? "すべての曜日の業務表で変わります。方ごとに変えた時刻はそのままです。"
            : `${groupName}の全員に、標準どおりで入ります。違う方だけ、あとでマスを直せます。`}
        </p>
        <form
          className="mt-3 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            decide();
          }}
        >
          {!editing && (
            <label className="flex flex-col gap-1 text-[14px]">
              業務の種類
              <select
                ref={first}
                value={templateId}
                onChange={(e) => onTemplate(e.target.value)}
                aria-invalid={errorField === "template" || undefined}
                aria-describedby={errorField === "template" ? "routine-panel-error" : undefined}
                className={`${input} w-full`}
              >
                <option value="" disabled>
                  選ぶ
                </option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="flex items-end gap-2">
            <label className="flex flex-col gap-1 text-[14px]">
              開始
              <input
                ref={editing ? first : undefined}
                value={startText}
                placeholder="例: 13:30"
                onChange={(e) => onStart(e.target.value)}
                aria-invalid={errorField === "start" || undefined}
                aria-describedby={errorField === "start" ? "routine-panel-error" : undefined}
                className={`${input} w-[104px]`}
              />
            </label>
            <span className="pb-2.5">–</span>
            <label className="flex flex-col gap-1 text-[14px]">
              終わり
              <input
                value={endText}
                placeholder="例: 14:00"
                onChange={(e) => {
                  setEndText(e.target.value);
                  setEndTouched(true);
                  setError(null);
    setErrorField(null);
                }}
                aria-invalid={errorField === "end" || undefined}
                aria-describedby={errorField === "end" ? "routine-panel-error" : undefined}
                className={`${input} w-[104px]`}
              />
            </label>
          </div>
          <div className="flex items-center gap-2 text-[14px]">
            <span id="routine-panel-headcount">必要人数</span>
            <button
              type="button"
              aria-label="1人減らす"
              disabled={headcount <= 1}
              onClick={() => {
                setHeadcount((n) => Math.max(1, n - 1));
                setHeadcountTouched(true);
              }}
              className="h-[44px] w-[44px] rounded-lg border border-[var(--cn-control-line)] bg-white text-[18px] disabled:opacity-40"
            >
              −
            </button>
            <output aria-labelledby="routine-panel-headcount" className="min-w-[3em] text-center text-[16px] font-bold">
              {headcount}人
            </output>
            <button
              type="button"
              aria-label="1人増やす"
              onClick={() => {
                setHeadcount((n) => Math.min(9, n + 1));
                setHeadcountTouched(true);
              }}
              className="h-[44px] w-[44px] rounded-lg border border-[var(--cn-control-line)] bg-white text-[18px]"
            >
              ＋
            </button>
          </div>
          {!editing && todayLabel && (
            <label className="flex min-h-[44px] items-center gap-2 text-[15px]">
              <input type="checkbox" className="h-5 w-5" checked={today} onChange={(e) => setToday(e.target.checked)} />
              今日（{todayLabel}）の時間割にも入れる
            </label>
          )}
          {error && (
            <p id="routine-panel-error" role="alert" className="text-[14px] font-bold text-[var(--cn-unassigned-ink)]">
              {error}
            </p>
          )}
          <button type="submit" className="inline-flex h-[44px] items-center justify-center rounded-lg bg-[var(--cn-accent)] px-4 font-bold text-white">
            この内容で決定
          </button>
          {editing &&
            (confirmRemove ? (
              <div className="flex flex-col gap-2 rounded-lg border border-[var(--cn-alert-line)] p-2.5">
                <p className="text-[14px]">この日課を業務表から外します。方ごとの時刻・なし・書いた文も外れます（元に戻すで戻せます）。</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => onDecide({ kind: "remove" })} className="h-[44px] flex-1 rounded-lg border border-[var(--cn-ink)] bg-white font-bold">
                    外す
                  </button>
                  <button type="button" onClick={() => setConfirmRemove(false)} className="h-[44px] flex-1 rounded-lg border border-[var(--cn-control-line)] bg-white">
                    やめる
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmRemove(true)} className="h-[44px] rounded-lg border border-[var(--cn-control-line)] bg-white text-[15px]">
                この日課を外す
              </button>
            ))}
          <button type="button" className="h-[44px] text-[14px] text-[var(--cn-ink-soft)] underline" onClick={onClose}>
            閉じる
          </button>
        </form>
      </div>
    </>
  );
}
