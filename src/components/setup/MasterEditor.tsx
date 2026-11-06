"use client";

import Link from "next/link";
import { useState } from "react";
import { addGroupEvents, groupMembers, removeGroupEvents, removeRoleSlotEvents, renameFacilityEvents, renameGroupEvents, roleSlotUsage, upsertRoleSlotEvents } from "@/domain/master";
import { himawariSeed } from "@/domain/seed";
import { fmtMin, parseClockInput } from "@/domain/time";
import type { ID, State } from "@/domain/types";
import { useEngine } from "@/store/react";

/**
 * 設定「追加・変更」の、施設の名前・グループ（ユニット・フロア）・番（役割枠）。決定記録 0016。
 * - グループを足すと、雛形の同じ種類の番と業務表の枠を写す。所属が残る間は外せない。
 * - 番の時刻を変えても、入れてある勤務表は変えない。
 * - 利用者・日課は利用者の画面、業務表はボードの ⋯ へ（ここには置かない）。
 */
export function MasterEditor({ state, today, onDone }: { state: State; today: string; onDone: (label: string) => void }) {
  const engine = useEngine();
  const [facilityName, setFacilityName] = useState(state.facility?.name ?? "");
  const [groupName, setGroupName] = useState("");
  const [editingGroup, setEditingGroup] = useState<ID | null>(null);
  const [groupEdit, setGroupEdit] = useState("");
  const [error, setError] = useState<Record<string, string>>({});
  const [slotOpen, setSlotOpen] = useState<ID | "new" | null>(null);
  const [slotForm, setSlotForm] = useState({ name: "", start: "", end: "", groupId: "", leader: "" });
  const groups = Object.values(state.groups).sort((a, b) => a.sortOrder - b.sortOrder);
  const slots = Object.values(state.roleSlots).sort((a, b) => a.sortOrder - b.sortOrder);
  const field = "h-[44px] rounded-lg border border-[var(--cn-control-line)] px-2.5 text-[15px]";
  const btn = "h-[44px] rounded-lg border border-[var(--cn-control-line)] bg-white px-3 text-[15px]";
  const primary = "h-[44px] rounded-lg bg-[var(--cn-accent)] px-4 font-bold text-white disabled:bg-[var(--cn-muted)]";
  if (!engine) return null;

  const run = async (key: string, r: { events: unknown[]; label: string; error?: string }) => {
    if (r.error) {
      setError((e) => ({ ...e, [key]: r.error! }));
      return false;
    }
    setError((e) => ({ ...e, [key]: "" }));
    if (r.events.length === 0) return true;
    await engine.dispatch(r.events as Parameters<typeof engine.dispatch>[0], r.label);
    onDone(r.label);
    return true;
  };

  const openSlot = (id: ID | "new") => {
    const sl = id === "new" ? undefined : state.roleSlots[id];
    setSlotForm({
      name: sl?.name ?? "",
      start: sl ? fmtMin(sl.defaultStartMin) : "",
      end: sl ? fmtMin(sl.defaultEndMin) : "",
      groupId: sl?.groupId ?? "",
      leader: sl?.leaderRank ? String(sl.leaderRank) : "",
    });
    setSlotOpen(id);
    setError((e) => ({ ...e, slot: "" }));
  };
  const saveSlot = async () => {
    const startMin = parseClockInput(slotForm.start);
    const endMin = parseClockInput(slotForm.end);
    if (startMin === null || endMin === null) {
      setError((e) => ({ ...e, slot: "時刻は 7:00 や 翌9:00 のように入れてください" }));
      return;
    }
    const ok = await run(
      "slot",
      upsertRoleSlotEvents(
        engine.state,
        {
          id: slotOpen === "new" ? undefined : (slotOpen ?? undefined),
          name: slotForm.name,
          startMin,
          endMin,
          groupId: slotForm.groupId || undefined,
          leaderRank: slotForm.leader ? Number(slotForm.leader) : undefined,
        },
        engine.context(),
      ),
    );
    if (ok) setSlotOpen(null);
  };

  const err = (key: string) =>
    error[key] ? (
      <p role="alert" className="rounded-lg border-2 border-[var(--cn-alert-line)] px-3 py-2 text-[15px]">
        {error[key]}
      </p>
    ) : null;

  return (
    <>
      <section aria-labelledby="s-facility" className="rounded-xl border border-[var(--cn-border)] bg-white p-4">
        <h3 id="s-facility" className="mb-1 text-[16px] font-bold">
          施設の名前
        </h3>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run("facility", renameFacilityEvents(engine.state, facilityName, engine.context()));
          }}
        >
          <label className="flex flex-col gap-1 text-[14px]">
            名前（上部バーに出ます）
            <input value={facilityName} onChange={(e) => setFacilityName(e.target.value)} className={`${field} w-[260px]`} />
          </label>
          <button type="submit" disabled={facilityName.trim() === (state.facility?.name ?? "")} className={primary}>
            この名前にする
          </button>
        </form>
        {err("facility")}
      </section>

      <section aria-labelledby="s-groups" className="rounded-xl border border-[var(--cn-border)] bg-white p-4">
        <h3 id="s-groups" className="mb-1 text-[16px] font-bold">
          グループ（ユニット・フロア）
        </h3>
        <p className="mb-2 text-[14px] text-[var(--cn-ink-soft)]">
          足すと、その種類（名前に「ユニット」があればユニット、ほかはフロア）の番と日課の枠が雛形から入り、次の日の時間割から出ます。要らない日課は利用者の画面で外せます。
          利用者・職員の所属が残っている間は外せません。
        </p>
        <ul role="list" aria-label="グループの一覧" className="flex flex-col divide-y divide-[var(--cn-card-line)]">
          {groups.map((g) => {
            const m = groupMembers(state, g.id);
            const open = editingGroup === g.id;
            return (
              <li key={g.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2">
                <span className="w-[220px] shrink-0">
                  <span className="font-bold">{g.name}</span>{" "}
                  <span className="text-[14px] text-[var(--cn-ink-soft)]">{g.kind === "common" ? "共通" : g.kind === "unit" ? "ユニット" : "フロア"}</span>
                  {g.kind !== "common" && (
                    <span className="block text-[13px] text-[var(--cn-muted)]">
                      利用者 {m.residents}人・職員 {m.staff}人
                    </span>
                  )}
                </span>
                {g.kind !== "common" && !open && (
                  <>
                    <button
                      type="button"
                      className={btn}
                      onClick={() => {
                        setEditingGroup(g.id);
                        setGroupEdit(g.name);
                        setError((e) => ({ ...e, group: "" }));
                      }}
                    >
                      名前を変える
                    </button>
                    <button
                      type="button"
                      className={btn}
                      aria-label={`${g.name}を外す`}
                      onClick={() => void run("group", removeGroupEvents(engine.state, g.id, engine.context()))}
                    >
                      外す
                    </button>
                  </>
                )}
                {open && (
                  <form
                    className="flex flex-wrap items-center gap-2"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (await run("group", renameGroupEvents(engine.state, g.id, groupEdit, engine.context()))) setEditingGroup(null);
                    }}
                  >
                    <label className="flex items-center gap-2 text-[14px]">
                      新しい名前
                      <input value={groupEdit} onChange={(e) => setGroupEdit(e.target.value)} className={`${field} w-[200px]`} aria-label={`${g.name}の新しい名前`} />
                    </label>
                    <button type="submit" className={primary}>
                      この名前にする
                    </button>
                    <button type="button" onClick={() => setEditingGroup(null)} className="h-[44px] px-3 text-[15px] text-[var(--cn-ink-soft)] underline">
                      閉じる
                    </button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run("group", addGroupEvents(engine.state, groupName, himawariSeed, engine.context()))) setGroupName("");
          }}
        >
          <label className="flex flex-col gap-1 text-[14px]">
            グループを足す（例: 3階、すみれユニット）
            <input value={groupName} onChange={(e) => setGroupName(e.target.value)} className={`${field} w-[240px]`} />
          </label>
          <button type="submit" disabled={!groupName.trim()} className={primary}>
            ＋ グループを足す
          </button>
        </form>
        {err("group")}
      </section>

      <section aria-labelledby="s-slots" className="rounded-xl border border-[var(--cn-border)] bg-white p-4">
        <h3 id="s-slots" className="mb-1 text-[16px] font-bold">
          番（早番A・遅番 など、その日の役割）
        </h3>
        <p className="mb-2 text-[14px] text-[var(--cn-ink-soft)]">
          名前・時刻・グループ・リーダーの順を直せます。時刻を変えても、入れてある勤務表の時刻はそのままです（次に貼る勤務表と、朝の帯で選び直した日から）。
          今日以降の勤務表か業務表で使われている番は外せません。
        </p>
        <ul role="list" aria-label="番の一覧" className="flex flex-col divide-y divide-[var(--cn-card-line)]">
          {slots.map((sl) => {
            const u = roleSlotUsage(state, sl.id, today);
            return (
              <li key={sl.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <button
                  type="button"
                  aria-expanded={slotOpen === sl.id}
                  aria-label={`番「${sl.name}」を直す`}
                  onClick={() => (slotOpen === sl.id ? setSlotOpen(null) : openSlot(sl.id))}
                  className="inline-flex h-[44px] w-[260px] shrink-0 flex-col items-start justify-center rounded-lg px-2 text-left hover:bg-[var(--cn-ground)]"
                >
                  <span>
                    <span className="font-bold underline decoration-[var(--cn-control-line)] underline-offset-4">{sl.name}</span>{" "}
                    <span className="text-[14px] text-[var(--cn-ink-soft)]">
                      {fmtMin(sl.defaultStartMin)}–{fmtMin(sl.defaultEndMin)}
                    </span>
                  </span>
                  <span className="text-[13px] text-[var(--cn-muted)]">
                    {sl.groupId ? state.groups[sl.groupId]?.name : "グループなし"}
                    {sl.leaderRank ? ` ・ リーダー ${sl.leaderRank}番目` : ""}
                    {u.rosterDays > 0 || u.patterns > 0 ? ` ・ 勤務表 ${u.rosterDays}日・業務表 ${u.patterns}` : ""}
                  </span>
                </button>
                {slotOpen === sl.id && (
                  <div className="basis-full">
                    <SlotForm
                      form={slotForm}
                      setForm={setSlotForm}
                      groups={groups.filter((g) => g.kind !== "common").map((g) => ({ id: g.id, name: g.name }))}
                      field={field}
                      primary={primary}
                      submitLabel="この内容で直す"
                      onSubmit={saveSlot}
                      onClose={() => setSlotOpen(null)}
                      onRemove={async () => {
                        if (await run("slot", removeRoleSlotEvents(engine.state, sl.id, today, engine.context()))) setSlotOpen(null);
                      }}
                      error={error.slot}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <div className="mt-3">
          {slotOpen === "new" ? (
            <SlotForm
              form={slotForm}
              setForm={setSlotForm}
              groups={groups.filter((g) => g.kind !== "common").map((g) => ({ id: g.id, name: g.name }))}
              field={field}
              primary={primary}
              submitLabel="この内容で足す"
              onSubmit={saveSlot}
              onClose={() => setSlotOpen(null)}
              error={error.slot}
            />
          ) : (
            <button type="button" className={`${btn} font-bold`} onClick={() => openSlot("new")}>
              ＋ 番を足す
            </button>
          )}
        </div>
      </section>

      <section aria-labelledby="s-elsewhere" className="rounded-xl border border-dashed border-[var(--cn-control-line)] p-4">
        <h3 id="s-elsewhere" className="mb-1 text-[16px] font-bold">
          ほかの画面で直すもの
        </h3>
        <ul className="flex flex-col gap-1 text-[15px]">
          <li>
            利用者（足す・直す・退所）と施設の日課（回数・時刻・方ごとの違い）:{" "}
            <Link href="/residents" className="inline-flex min-h-[44px] items-center font-bold text-[var(--cn-accent)] underline">
              利用者の画面へ
            </Link>
          </li>
          <li>
            業務表（一日の仕事の並び）: ボードで今日の時間割を直してから「⋯ → 今日を業務表として保存」。{" "}
            <Link href="/board" className="inline-flex min-h-[44px] items-center font-bold text-[var(--cn-accent)] underline">
              ボードへ
            </Link>
          </li>
          <li>その日の番（早番・遅番）: ボードの朝の帯で「番を選ぶ」。月ごとにまとめて入れるなら下の「月の勤務表を貼り付ける」。</li>
        </ul>
      </section>
    </>
  );
}

function SlotForm({
  form,
  setForm,
  groups,
  field,
  primary,
  submitLabel,
  onSubmit,
  onClose,
  onRemove,
  error,
}: {
  form: { name: string; start: string; end: string; groupId: string; leader: string };
  setForm: (f: { name: string; start: string; end: string; groupId: string; leader: string }) => void;
  groups: { id: ID; name: string }[];
  field: string;
  primary: string;
  submitLabel: string;
  onSubmit: () => void;
  onClose: () => void;
  onRemove?: () => void;
  error?: string;
}) {
  return (
    <form
      aria-label={submitLabel === "この内容で足す" ? "番を足す" : `番「${form.name}」を直す`}
      className="mt-2 flex flex-col gap-3 rounded-xl border-2 border-[var(--cn-accent)] bg-white p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-[14px]">
          名前
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={`${field} w-[160px]`} placeholder="例: 早番A" />
        </label>
        <label className="flex flex-col gap-1 text-[14px]">
          開始
          <input value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} className={`${field} w-[110px]`} placeholder="例: 7:00" />
        </label>
        <label className="flex flex-col gap-1 text-[14px]">
          終わり（翌日は 翌9:00）
          <input value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} className={`${field} w-[140px]`} placeholder="例: 16:00" />
        </label>
        <label className="flex flex-col gap-1 text-[14px]">
          グループ
          <select value={form.groupId} onChange={(e) => setForm({ ...form, groupId: e.target.value })} className={`${field} w-[180px]`}>
            <option value="">なし（どのグループでも）</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[14px]">
          リーダーの順（困ったらの相談先）
          <select value={form.leader} onChange={(e) => setForm({ ...form, leader: e.target.value })} className={`${field} w-[180px]`}>
            <option value="">リーダーの番ではない</option>
            <option value="1">1 番目</option>
            <option value="2">2 番目</option>
            <option value="3">3 番目</option>
          </select>
        </label>
      </div>
      {error && (
        <p role="alert" className="rounded-lg border-2 border-[var(--cn-alert-line)] px-3 py-2 text-[15px]">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className={primary}>
          {submitLabel}
        </button>
        <button type="button" onClick={onClose} className="h-[44px] px-3 text-[15px] text-[var(--cn-ink-soft)] underline">
          閉じる
        </button>
        {onRemove && (
          <button type="button" onClick={onRemove} className="ml-auto h-[44px] rounded-lg border border-[var(--cn-control-line)] bg-white px-3 text-[15px]">
            この番を外す
          </button>
        )}
      </div>
    </form>
  );
}
