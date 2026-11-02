"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Routine } from "@/domain/routine";
import type { RoutineChange } from "@/domain/residentsIO";
import { alignToReference, clockLabel, parseTime } from "@/domain/time";

export interface CellTarget {
  /** 例: 「田中様」「3人」 */
  who: string;
  residentIds: string[];
  routine: Routine;
  /** 入力欄の初期値（分） */
  startMin: number;
  /** パネルを出す位置の基準（押したマス） */
  anchor: DOMRect;
}

/**
 * 日課のマスを直す小さなパネル（一覧・24時間シート共通）。
 * 時刻の入力（開始）＋「この内容で決定」／「この方はなし」／「標準に戻す」。既定値は今の時刻。
 */
export function CellPanel({ target, onDecide, onClose }: { target: CellTarget; onDecide: (c: RoutineChange) => void; onClose: () => void }) {
  const [text, setText] = useState(clockLabel(target.startMin));
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: target.anchor.bottom + 4, left: target.anchor.left });
  const many = target.residentIds.length > 1;
  const { routine } = target;

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  // 画面からはみ出さないように寄せる
  useLayoutEffect(() => {
    const el = panel.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let top = target.anchor.bottom + 4;
    if (top + h > window.innerHeight - 8) top = Math.max(8, target.anchor.top - h - 4);
    const left = Math.min(Math.max(8, target.anchor.left), window.innerWidth - w - 8);
    setPos({ top, left });
  }, [target.anchor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const shift = (d: number) => {
    const cur = parseTime(text);
    const base = cur === null ? target.startMin : alignToReference(cur, routine.startMin);
    setText(clockLabel(Math.max(0, base + d)));
    setError(null);
  };

  const decide = () => {
    const m = parseTime(text);
    if (m === null) {
      setError("時刻は 8:30 のように入れてください");
      input.current?.focus();
      return;
    }
    // 夜勤側の日課（翌6:00 の起床など）にも「6:30」と入れれば合うように、標準にいちばん近い日に合わせる
    onDecide({ kind: "time", startMin: alignToReference(m, routine.startMin) });
  };

  const btn = "inline-flex h-[44px] items-center justify-center rounded-lg border border-[var(--cn-control-line)] bg-white px-3 text-[15px]";

  return (
    <>
      <div className="fixed inset-0 z-40" aria-hidden="true" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={`${target.who}の${routine.name}を直す`}
        className="fixed z-50 w-[320px] rounded-xl border border-[var(--cn-card-line)] bg-white p-4 shadow-xl"
        style={{ top: pos.top, left: pos.left }}
      >
        <p className="font-bold">
          {target.who}の{routine.name}
        </p>
        <p className="text-[14px] text-[var(--cn-muted)]">標準 {clockLabel(routine.startMin)}–{clockLabel(routine.endMin)}</p>
        <form
          className="mt-3 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            decide();
          }}
        >
          <div className="flex items-end gap-2">
            <label className="flex flex-col gap-1 text-[14px]">
              開始
              <input
                ref={input}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setError(null);
                }}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "cell-panel-error" : undefined}
                className="h-[44px] w-[96px] rounded-lg border border-[var(--cn-control-line)] px-2 text-[16px]"
              />
            </label>
            <button type="button" className={btn} onClick={() => shift(-15)} aria-label="15分早く">
              −15分
            </button>
            <button type="button" className={btn} onClick={() => shift(15)} aria-label="15分遅く">
              ＋15分
            </button>
          </div>
          {error && (
            <p id="cell-panel-error" className="text-[14px] font-bold text-[var(--cn-unassigned-ink)]">
              {error}
            </p>
          )}
          <button type="submit" className="inline-flex h-[44px] items-center justify-center rounded-lg bg-[var(--cn-accent)] px-4 font-bold text-white">
            この内容で決定
          </button>
          <div className="flex gap-2">
            <button type="button" className={`${btn} flex-1`} onClick={() => onDecide({ kind: "skip" })}>
              {many ? "選んだ方はなし" : "この方はなし"}
            </button>
            <button type="button" className={`${btn} flex-1`} onClick={() => onDecide({ kind: "reset" })}>
              標準に戻す
            </button>
          </div>
          <button type="button" className="h-[44px] text-[14px] text-[var(--cn-ink-soft)] underline" onClick={onClose}>
            閉じる
          </button>
        </form>
      </div>
    </>
  );
}

/** トーストに出す文 */
export function changeLabel(who: string, routine: Routine, c: RoutineChange): string {
  if (c.kind === "skip") return `${who}の${routine.name}をなしにしました`;
  if (c.kind === "reset" || c.startMin === routine.startMin) return `${who}の${routine.name}を標準に戻しました`;
  return `${who}の${routine.name}を ${clockLabel(c.startMin)} にしました`;
}
