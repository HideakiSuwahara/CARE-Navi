"use client";

import { useEffect, useRef, useState } from "react";
import { removeStaffEvents, staffFormEvents, staffFutureAssignments } from "@/domain/people";
import type { ID, State } from "@/domain/types";
import { useEngine } from "@/store/react";

/**
 * 職員を 1 人ずつ足す・直す・退職にする（設定の「職員」。決定記録 0015）。
 * 貼り付けと同じイベント。1 操作 1 バッチで元に戻せる。担当条件は行の □／✓ で付け外し（足すときはここでも選べる）。
 */
export function StaffEditor({
  state,
  staffId,
  tags,
  today,
  onDone,
  onClose,
}: {
  state: State;
  /** 直す人。無ければ新しく足す */
  staffId?: ID;
  /** 足すときに選べる担当条件 */
  tags: string[];
  today: string;
  onDone: (label: string) => void;
  onClose: () => void;
}) {
  const engine = useEngine();
  const prev = staffId ? state.staff[staffId] : undefined;
  const [name, setName] = useState(prev?.displayName ?? "");
  const [role, setRole] = useState(prev?.role ?? "");
  const [phone, setPhone] = useState(prev?.phone ?? "");
  const [picked, setPicked] = useState<string[]>(prev?.tags ?? []);
  const [error, setError] = useState("");
  const [confirmRetire, setConfirmRetire] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    first.current?.focus();
  }, []);
  if (!engine) return null;

  const save = async () => {
    const r = staffFormEvents(engine.state, { id: prev?.id, displayName: name, role, tags: prev ? prev.tags : picked, phone }, engine.context());
    if (r.error) {
      setError(r.error);
      return;
    }
    await engine.dispatch(r.events, r.label);
    onDone(r.label);
  };
  const retire = async () => {
    if (!prev) return;
    const r = removeStaffEvents(engine.state, prev.id, today, engine.context());
    if (r.error) {
      setError(r.error);
      return;
    }
    await engine.dispatch(r.events, r.label);
    onDone(r.label);
  };
  const future = prev ? staffFutureAssignments(state, prev.id, today) : 0;
  const field = "h-[44px] rounded-lg border border-[var(--cn-control-line)] px-2.5 text-[15px]";
  const title = prev ? `${prev.surname}さんを直す` : "職員を 1 人足す";

  return (
    <form
      aria-label={title}
      className="mt-2 flex flex-col gap-3 rounded-xl border-2 border-[var(--cn-accent)] bg-white p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="font-bold">{title}</p>
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-[14px]">
          名前（姓 名）
          <input ref={first} value={name} onChange={(e) => setName(e.target.value)} className={`${field} w-[200px]`} placeholder="例: 野村 ミホ" />
        </label>
        <label className="flex flex-col gap-1 text-[14px]">
          職種
          <input value={role} onChange={(e) => setRole(e.target.value)} list="staff-roles" className={`${field} w-[160px]`} placeholder="例: 介護職員" />
          <datalist id="staff-roles">
            {[...new Set(Object.values(state.staff).map((s) => s.role))].map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </label>
        <label className="flex flex-col gap-1 text-[14px]">
          PHS（任意）
          <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="numeric" className={`${field} w-[120px]`} placeholder="例: 811" />
        </label>
      </div>
      {!prev && tags.length > 0 && (
        <fieldset className="flex flex-wrap items-center gap-1.5">
          <legend className="mb-1 text-[14px]">担当条件（施設が決めた条件を持っているか）</legend>
          {tags.map((t) => {
            const on = picked.includes(t);
            return (
              <button
                key={t}
                type="button"
                aria-pressed={on}
                onClick={() => setPicked((p) => (on ? p.filter((x) => x !== t) : [...p, t]))}
                className={`inline-flex h-[44px] items-center gap-1 rounded-lg border px-3 text-[15px] ${
                  on ? "border-2 border-[var(--cn-accent)] bg-[var(--cn-accent-soft)] font-bold text-[var(--cn-accent)]" : "border-[var(--cn-control-line)] bg-white"
                }`}
              >
                <span aria-hidden="true">{on ? "✓" : "□"}</span>
                {t}
              </button>
            );
          })}
        </fieldset>
      )}
      {error && (
        <p role="alert" className="rounded-lg border-2 border-[var(--cn-alert-line)] px-3 py-2 text-[15px]">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className="h-[44px] rounded-lg bg-[var(--cn-accent)] px-4 font-bold text-white">
          {prev ? "この内容で直す" : "この内容で足す"}
        </button>
        <button type="button" onClick={onClose} className="h-[44px] rounded-lg px-3 text-[15px] text-[var(--cn-ink-soft)] underline">
          閉じる
        </button>
        {prev && !confirmRetire && (
          <button type="button" onClick={() => setConfirmRetire(true)} className="ml-auto h-[44px] rounded-lg border border-[var(--cn-control-line)] bg-white px-3 text-[15px]">
            退職にする
          </button>
        )}
      </div>
      {prev && confirmRetire && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--cn-control-line)] p-3 text-[15px]">
          <span>
            {prev.surname}さんを一覧から外します。{future > 0 ? `今日以降の担当 ${future}件からも外れます（外れた枠は「担当未定」になります）。` : "今日以降の担当はありません。"}元に戻せます。
          </span>
          <button type="button" onClick={retire} className="h-[44px] rounded-lg border-2 border-[var(--cn-alert-line)] bg-white px-4 font-bold">
            退職にする
          </button>
          <button type="button" onClick={() => setConfirmRetire(false)} className="h-[44px] rounded-lg px-3 text-[15px] text-[var(--cn-ink-soft)] underline">
            やめる
          </button>
        </div>
      )}
    </form>
  );
}
