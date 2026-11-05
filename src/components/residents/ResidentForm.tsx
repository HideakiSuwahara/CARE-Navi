"use client";

import { useEffect, useRef, useState } from "react";
import { removeResidentEvents, residentFormEvents, residentFutureTargets } from "@/domain/people";
import type { ID, State } from "@/domain/types";
import { useEngine } from "@/store/react";

/**
 * 利用者を 1 人ずつ足す・直す・退所にする（利用者の画面。決定記録 0015）。
 * 貼り付けと同じイベント。1 操作 1 バッチで元に戻せる。足した方は施設の日課が標準どおりに入る（0004 §3）。
 */
export function ResidentForm({
  state,
  groupId,
  today,
  onDone,
  onClose,
}: {
  state: State;
  /** いま選んでいるグループ（足すときの既定） */
  groupId?: ID;
  today: string;
  onDone: (label: string, groupId: ID, residentId?: ID) => void;
  onClose: () => void;
}) {
  const engine = useEngine();
  const groups = Object.values(state.groups)
    .filter((g) => g.kind !== "common")
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const [pickedId, setPickedId] = useState<string>("");
  const prev = pickedId ? state.residents[pickedId] : undefined;
  const [name, setName] = useState("");
  const [group, setGroup] = useState<string>(groupId ?? groups[0]?.id ?? "");
  const [room, setRoom] = useState("");
  const [error, setError] = useState("");
  const [confirmLeave, setConfirmLeave] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    first.current?.focus();
  }, []);
  // 直す方を選んだら、その方の値を欄に入れる
  const pick = (id: string) => {
    setPickedId(id);
    setError("");
    setConfirmLeave(false);
    const r = state.residents[id];
    setName(r?.displayName ?? "");
    setGroup(r?.groupId ?? groupId ?? groups[0]?.id ?? "");
    setRoom(r?.room ?? "");
  };
  if (!engine) return null;

  const list = Object.values(state.residents)
    .filter((r) => !groupId || r.groupId === groupId)
    .sort((a, b) => a.room.localeCompare(b.room, "ja", { numeric: true }));

  const save = async () => {
    const r = residentFormEvents(engine.state, { id: prev?.id, displayName: name, groupId: group, room }, engine.context());
    if (r.error) {
      setError(r.error);
      return;
    }
    await engine.dispatch(r.events, r.label);
    const id = prev?.id ?? (r.events[0].type === "resident.upsert" ? r.events[0].resident.id : undefined);
    onDone(r.label, group, id);
  };
  const leave = async () => {
    if (!prev) return;
    const r = removeResidentEvents(engine.state, prev.id, today, engine.context());
    if (r.error) {
      setError(r.error);
      return;
    }
    await engine.dispatch(r.events, r.label);
    onDone(r.label, prev.groupId);
  };
  const future = prev ? residentFutureTargets(state, prev.id, today) : 0;
  const field = "h-[44px] rounded-lg border border-[var(--cn-control-line)] px-2.5 text-[15px]";
  const title = prev ? `${prev.surname}様を直す` : "利用者を 1 人足す";

  return (
    <section aria-labelledby="rf-title" className="cn-noprint rounded-xl border border-[var(--cn-card-line)] bg-white p-4">
      <h2 id="rf-title" className="font-bold">
        1 人ずつ足す・直す
      </h2>
      <p className="mt-1 text-[14px] text-[var(--cn-ink-soft)]">まとめて入れるときは「名簿を貼り付ける」。足した方は、施設の日課が標準どおりに入ります。</p>
      <label className="mt-2 flex flex-col gap-1 text-[14px]">
        直す方（新しく足すときは「新しく足す」のまま）
        <select value={pickedId} onChange={(e) => pick(e.target.value)} className={`${field} w-[280px]`}>
          <option value="">新しく足す</option>
          {list.map((r) => (
            <option key={r.id} value={r.id}>
              {r.room ? `${r.room} ` : ""}
              {r.displayName}様
            </option>
          ))}
        </select>
      </label>
      <form
        aria-label={title}
        className="mt-3 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1 text-[14px]">
            名前（姓 名）
            <input ref={first} value={name} onChange={(e) => setName(e.target.value)} className={`${field} w-[200px]`} placeholder="例: 山本 ハル" />
          </label>
          <label className="flex flex-col gap-1 text-[14px]">
            グループ
            <select value={group} onChange={(e) => setGroup(e.target.value)} className={`${field} w-[180px]`}>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[14px]">
            部屋
            <input value={room} onChange={(e) => setRoom(e.target.value)} className={`${field} w-[100px]`} placeholder="例: 110" />
          </label>
        </div>
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
          {prev && !confirmLeave && (
            <button type="button" onClick={() => setConfirmLeave(true)} className="ml-auto h-[44px] rounded-lg border border-[var(--cn-control-line)] bg-white px-3 text-[15px]">
              退所にする
            </button>
          )}
        </div>
        {prev && confirmLeave && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--cn-control-line)] p-3 text-[15px]">
            <span>
              {prev.surname}様を一覧から外します。{future > 0 ? `今日以降の対象 ${future}件からも外れます。` : ""}元に戻せます（24時間シートも戻ります）。
            </span>
            <button type="button" onClick={leave} className="h-[44px] rounded-lg border-2 border-[var(--cn-alert-line)] bg-white px-4 font-bold">
              退所にする
            </button>
            <button type="button" onClick={() => setConfirmLeave(false)} className="h-[44px] rounded-lg px-3 text-[15px] text-[var(--cn-ink-soft)] underline">
              やめる
            </button>
          </div>
        )}
      </form>
    </section>
  );
}
