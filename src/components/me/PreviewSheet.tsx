"use client";

import { useState, type ReactNode } from "react";
import type { Event } from "@/domain/events";
import { defaultUnchecked, effectLines, selectPreview, type Preview } from "@/domain/commands";
import type { DateKey, ID, State } from "@/domain/types";
import { Sheet } from "./Sheet";

/**
 * 「こう変わります」の一覧 → 「この内容で決定（元に戻せます）」。docs/screens.md §0.6
 * - 外せる行はチェックで外せる。候補として出すだけの行（中止の候補など）は最初からチェックなし
 * - 結果として出る「担当未定」「担当あと n 人」は外せない行として出す
 */
export function PreviewSheet({
  preview,
  title,
  onClose,
  onBack,
  backLabel,
  onDecide,
  state,
  date,
  resetKey,
  children,
}: {
  preview: Preview;
  /** 結果の行（担当未定になります）をチェックに合わせて作り直すため */
  state: State;
  date: DateKey;
  /** 入力（種類・時間・担当）が変わったら、チェックを既定に戻す。シートは開いたまま（フォーカスを動かさない） */
  resetKey?: string;
  title: string;
  onClose: () => void;
  onBack?: () => void;
  backLabel?: string;
  onDecide: (events: Event[]) => void;
  children?: ReactNode;
}) {
  const [checks, setChecks] = useState<{ key?: string; unchecked: Set<ID> }>(() => ({ key: resetKey, unchecked: defaultUnchecked(preview) }));
  if (checks.key !== resetKey) setChecks({ key: resetKey, unchecked: defaultUnchecked(preview) });
  const unchecked = checks.key === resetKey ? checks.unchecked : defaultUnchecked(preview);
  const setUnchecked = (fn: (prev: Set<ID>) => Set<ID>) => setChecks((c) => ({ key: c.key, unchecked: fn(c.unchecked) }));
  const events = selectPreview(preview, unchecked);
  // 結果の行は、いま選んでいる行だけを当てた結果で出す（チェックを外したら書き換わる）
  const lines = [...preview.lines.filter((l) => !l.computed), ...effectLines(state, events, date)];
  const toggle = (ids: ID[], on: boolean) =>
    setUnchecked((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.delete(id);
        else next.add(id);
      }
      return next;
    });

  return (
    <Sheet
      title={title}
      subtitle="こう変わります"
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={events.length === 0}
            onClick={() => onDecide(events)}
            className="h-[56px] w-full rounded-xl bg-[var(--cn-accent)] text-[18px] font-bold text-white disabled:bg-[var(--cn-muted)]"
          >
            この内容で決定<span className="text-[15px] font-normal">（元に戻せます）</span>
          </button>
          {onBack && (
            <button type="button" onClick={onBack} className="h-[44px] w-full rounded-lg border border-[var(--cn-control-line)] bg-white text-[16px]">
              {backLabel ?? "戻る"}
            </button>
          )}
        </div>
      }
    >
      {children}
      <section aria-labelledby="pv-lines">
        <h3 id="pv-lines" className="mb-1.5 text-[14px] font-bold text-[var(--cn-muted)]">
          変わること
        </h3>
        <p className="mb-1.5 text-[14px] text-[var(--cn-ink-soft)]">チェックのある行を行います。外すとその行はしません。「候補」の行は、チェックを入れると行います。</p>
        <ul className="flex flex-col divide-y divide-[var(--cn-grid)] rounded-xl border border-[var(--cn-border)] bg-white">
          {lines.map((l, i) => {
            const on = l.eventIds.every((id) => !unchecked.has(id));
            return (
              <li key={i} className="px-3 py-2">
                {l.optional && l.eventIds.length > 0 ? (
                  <label className="flex min-h-[44px] cursor-pointer items-start gap-3">
                    <input type="checkbox" checked={on} onChange={(e) => toggle(l.eventIds, e.target.checked)} className="mt-1 h-[22px] w-[22px] shrink-0 accent-[var(--cn-accent)]" />
                    <span className={on ? "" : l.defaultOn === false ? "text-[var(--cn-ink-soft)]" : "text-[var(--cn-muted)] line-through"}>
                      {!on && l.defaultOn === false && <span className="mr-1 rounded border border-[var(--cn-control-line)] px-1 text-[13px]">候補</span>}
                      {l.text}
                    </span>
                  </label>
                ) : (
                  <p className={`flex min-h-[32px] items-start gap-2 ${l.kind === "effect" ? "font-bold text-[var(--cn-unassigned-ink)]" : ""}`}>
                    <span aria-hidden="true">{l.kind === "effect" ? "→" : "・"}</span>
                    <span>{l.text}</span>
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </Sheet>
  );
}
