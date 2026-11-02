"use client";

import { useMemo, useState } from "react";
import { useEngine } from "@/store/react";
import { metaOf } from "@/domain/pattern";
import { parseResidentPaste } from "@/domain/residentsIO";
import type { Event } from "@/domain/events";
import type { ID, State } from "@/domain/types";

/**
 * 名簿の貼り付け: 1行1人「名前, グループ, 部屋」。足した方は全員が標準どおり（決定記録 0004 §3）。
 * 失敗した行は行番号と理由を出し、読めた行だけ足す。
 */
export function PastePanel({ state, onClose, onAdded }: { state: State; onClose: () => void; onAdded: (groupId: ID) => void }) {
  const engine = useEngine();
  const [text, setText] = useState("");
  const result = useMemo(() => parseResidentPaste(state, text), [state, text]);
  const groupNames = Object.values(state.groups)
    .filter((g) => g.kind !== "common")
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((g) => g.name);
  const example = `山本 ハル, ${groupNames[0] ?? "東フロア"}, 110`;

  const add = () => {
    if (!engine || result.residents.length === 0) return;
    const ctx = engine.context();
    const events: Event[] = result.residents.map((r) => ({
      ...metaOf(ctx),
      type: "resident.upsert",
      resident: { id: ctx.newId(), displayName: r.displayName, surname: r.surname, groupId: r.groupId, room: r.room },
    }));
    const n = result.residents.length;
    void engine.dispatch(events, n === 1 ? `${result.residents[0].surname}様を足しました` : `${n}人の利用者を足しました`);
    onAdded(result.residents[0].groupId);
  };

  return (
    <section aria-labelledby="paste-title" className="cn-noprint rounded-xl border border-[var(--cn-card-line)] bg-white p-4">
      <h2 id="paste-title" className="font-bold">
        名簿を貼り付ける
      </h2>
      <p className="mt-1 text-[14px] text-[var(--cn-ink-soft)]">
        1行に1人、「名前, グループ, 部屋」の順。Excel からそのまま貼り付けられます。グループは {groupNames.join("・")}。足した方は、施設の日課が標準どおりに入ります。
      </p>
      <label className="mt-2 block text-[14px]">
        名簿
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          placeholder={example}
          className="mt-1 block w-full rounded-lg border border-[var(--cn-control-line)] px-3 py-2 text-[15px]"
        />
      </label>
      {text.trim() && (
        <div className="mt-2 text-[14px]" aria-live="polite">
          <p className="font-bold">{result.residents.length}人を足せます</p>
          {result.errors.length > 0 && (
            <ul className="mt-1 text-[var(--cn-unassigned-ink)]">
              {result.errors.map((e) => (
                <li key={e.line}>
                  {e.line}行目: {e.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={add}
          disabled={result.residents.length === 0}
          className="inline-flex h-[44px] items-center rounded-lg bg-[var(--cn-accent)] px-4 font-bold text-white disabled:bg-[var(--cn-muted)]"
        >
          この内容で足す
        </button>
        <button type="button" onClick={onClose} className="inline-flex h-[44px] items-center rounded-lg px-3 text-[15px] text-[var(--cn-ink-soft)] underline">
          閉じる
        </button>
      </div>
    </section>
  );
}
