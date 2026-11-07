"use client";

import { useEffect, useRef, useState } from "react";
import { assigneesOf, canMarkDone, headcountStatus, taskLabel, taskStarted , boardName } from "@/domain/checks";
import { cancelTaskEvents, doerChoices, doneByEvents, setTaskSlotEvents, shiftTaskEvents, slotChoices, swapChoices, swapPreview, unassignEvents, type DoerChoice, type SwapChoice } from "@/domain/commands";
import { sheetRowFor } from "@/domain/routine";
import { clockLabel, fmtRange } from "@/domain/time";
import type { ID, State } from "@/domain/types";
import type { Engine } from "@/store/engine";
import { useDefaultDate, useNowMinutes } from "@/store/react";
import { DoneButton } from "@/components/DoneButton";

/**
 * 業務の詳細（ボードでカードの名前を押すと右に開く）。
 * - 対象の方ごとに、時刻（枠の中で時刻が違う方はその時刻）と、24時間シートの「サポートが必要なこと」を1行（決定記録 0004 §4）
 * - お願いすること／しないこと・手順・物品・相談先は業務の種類から
 * ボード（施設の PC）なので利用者はフルネームで出す。手元画面（自分の予定）は表示名の設定に従う（D3）。
 */
export function TaskDetail({
  state,
  engine,
  taskId,
  onClose,
  onAdd,
}: {
  state: State;
  engine?: Engine | null;
  taskId: ID;
  onClose: () => void;
  onAdd?: (taskId: ID) => void;
}) {
  const task = state.tasks[taskId];
  const closeRef = useRef<HTMLButtonElement>(null);
  // 担当の入れ替え（決定記録 0021）: だれを → だれと → こう変わります → 決定
  const [swapFrom, setSwapFrom] = useState<ID | null>(null);
  const [swapWith, setSwapWith] = useState<SwapChoice | null>(null);
  const swapRef = useRef<HTMLDivElement>(null);
  // やった人を変える（決定記録 0022）
  const [doerOpen, setDoerOpen] = useState(false);
  const clock = useNowMinutes();
  const today = useDefaultDate(state, "business");

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!task) return null;
  const status = headcountStatus(state, task.id);
  const assignees = assigneesOf(state, task.id);
  const targets = (state.targets[task.id] ?? []).map((rid) => state.residents[rid]).filter(Boolean);
  const group = task.groupId ? state.groups[task.groupId] : undefined;
  const isBreak = task.kind === "break";
  const short = !isBreak && (status.level === "unassigned" || status.level === "short");

  const unassign = (staffId: ID, surname: string) => {
    if (!engine) return;
    engine.dispatch(unassignEvents(engine.state, task.id, staffId, engine.context()), `${surname}さんを「${taskLabel(engine.state, task)}」の担当から外しました`);
    // 押したボタンが消えるので、見出しへ
    window.setTimeout(() => document.getElementById("task-detail-title")?.focus(), 0);
  };
  const openSwap = (staffId: ID | null) => {
    setSwapFrom(staffId);
    setSwapWith(null);
    if (staffId) requestAnimationFrame(() => swapRef.current?.querySelector<HTMLElement>("button")?.focus());
  };
  const doSwap = () => {
    if (!engine || !swapFrom || !swapWith) return;
    const p = swapPreview(engine.state, { taskId: task.id, staffId: swapFrom }, swapWith, engine.context());
    if (p.events.length === 0) return;
    engine.dispatch(p.events, p.label);
    const back = swapFrom;
    setSwapFrom(null);
    setSwapWith(null);
    window.setTimeout(() => (document.querySelector<HTMLElement>(`[data-swap-open="${back}"]`) ?? document.getElementById("task-detail-title"))?.focus(), 0);
  };
  const shift = (delta: number) => {
    if (!engine) return;
    const word = `${Math.abs(delta)}分${delta > 0 ? "後へ" : "前へ"}`;
    engine.dispatch(shiftTaskEvents(engine.state, task.id, delta, engine.context()), `「${task.name}」を${word}ずらしました`);
  };
  const cancel = () => {
    if (!engine) return;
    engine.dispatch(cancelTaskEvents(task.id, engine.context()), `「${task.name}」を中止にしました`);
    onClose();
  };

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-labelledby="task-detail-title"
      className="fixed inset-y-0 right-0 z-40 flex w-[460px] max-w-full flex-col border-l border-[var(--cn-border)] bg-white shadow-[-8px_0_24px_rgba(0,0,0,0.08)]"
    >
      <div className="flex items-start gap-3 border-b border-[var(--cn-border)] p-4">
        <div className="min-w-0 flex-1">
          <h2 id="task-detail-title" tabIndex={-1} className="text-[18px] font-bold outline-none">
            {task.name}
          </h2>
          <p className="text-[15px] text-[var(--cn-ink-soft)]">
            {fmtRange(task.startMin, task.endMin)}
            {group && group.kind !== "common" && ` ・ ${group.name}`}
            {task.place && ` ・ ${task.place}`}
          </p>
          {task.requiredTags.length > 0 && <p className="text-[14px] text-[var(--cn-ink-soft)]">条件: {task.requiredTags.join("・")}（施設の設定。職員ごとの付け外しは設定）</p>}
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="閉じる"
          className="inline-flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-lg bg-[var(--cn-ground)] text-[20px]"
        >
          ×
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-auto p-4">
        <section aria-labelledby="d-staff">
          <h3 id="d-staff" className="mb-1.5 text-[14px] font-bold text-[var(--cn-muted)]">
            担当
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            {assignees.map((s) => (
              <span key={s.id} className="inline-flex h-[44px] items-center gap-1 rounded-full border border-[var(--cn-accent)] bg-[var(--cn-accent-soft)] pl-3 text-[15px] text-[var(--cn-accent)]">
                {boardName(state, s.id)}
                {engine && (
                  <button
                    type="button"
                    onClick={() => unassign(s.id, boardName(state, s.id))}
                    aria-label={`${boardName(state, s.id)}さんを担当から外す`}
                    className="inline-flex h-[44px] w-[44px] items-center justify-center rounded-full text-[17px]"
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
            {assignees.length === 0 && <span className="text-[15px] text-[var(--cn-ink-soft)]">決まっていません</span>}
            {short && (
              <span
                className={`inline-flex h-[32px] items-center rounded-md px-2.5 text-[14px] font-bold ${
                  status.level === "unassigned" ? "bg-[var(--cn-unassigned-bg)] text-[var(--cn-unassigned-ink)]" : "bg-[var(--cn-short-bg)] text-[var(--cn-short-ink)]"
                }`}
              >
                {status.label}
              </span>
            )}
            {onAdd && (
              <button type="button" onClick={() => onAdd(task.id)} className="h-[44px] rounded-lg border border-dashed border-[var(--cn-muted)] px-3 text-[15px]">
                ＋ 担当を追加
              </button>
            )}
          </div>
          {engine && !isBreak && assignees.length > 0 && (
            <div role="group" aria-labelledby="d-swap-title" className="mt-2 flex flex-wrap items-center gap-2">
              {/* 予定の付け替え（印は付かない）と、終わったの印・やった人を分けて書く（どれを押すか迷わないように。ループ 22） */}
              <h4 id="d-swap-title" className="basis-full text-[14px] font-bold text-[var(--cn-muted)]">
                予定を変える
              </h4>
              <span id="d-swap-hint" className="-mt-1.5 basis-full text-[14px] text-[var(--cn-ink-soft)]">
                時間の重なるほかの業務の人と担当を入れ替えます（「終わった」の印は付きません）
              </span>
              {assignees.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  data-swap-open={s.id}
                  aria-expanded={swapFrom === s.id}
                  aria-describedby="d-swap-hint"
                  onClick={() => openSwap(swapFrom === s.id ? null : s.id)}
                  className="h-[44px] rounded-lg border border-[var(--cn-control-line)] px-3 text-[15px]"
                >
                  {boardName(state, s.id)}さんの担当を入れ替える…
                </button>
              ))}
            </div>
          )}
          {engine && swapFrom && (
            <SwapBox
              state={state}
              taskId={task.id}
              staffId={swapFrom}
              picked={swapWith}
              onPick={setSwapWith}
              onDecide={doSwap}
              onCancel={() => {
                const back = swapFrom;
                openSwap(null);
                window.setTimeout(() => document.querySelector<HTMLElement>(`[data-swap-open="${back}"]`)?.focus(), 0);
              }}
              boxRef={swapRef}
            />
          )}
        </section>

        {engine && canMarkDone(task) && (
          <section aria-labelledby="d-done" className="flex flex-col gap-1.5">
            <h3 id="d-done" className="text-[14px] font-bold text-[var(--cn-muted)]">
              終わったの印・やった人
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              <DoneButton task={task} />
              {(task.done || (today !== null && clock !== null && taskStarted(task, today, clock))) && (
                <button
                  type="button"
                  data-doer-open
                  aria-expanded={doerOpen}
                  aria-controls={doerOpen ? "doer-box" : undefined}
                  aria-describedby="d-doer-hint"
                  onClick={() => setDoerOpen((v) => !v)}
                  className="h-[44px] rounded-lg border border-[var(--cn-control-line)] px-3 text-[15px]"
                >
                  やった人を変える…
                </button>
              )}
            </div>
            {(task.done || (today !== null && clock !== null && taskStarted(task, today, clock))) && (
              <p id="d-doer-hint" className="text-[14px] text-[var(--cn-ink-soft)]">
                代わってもらったとき・担当を決めないままやったときに。やった人を担当にして「終わった」の印も付けます。
              </p>
            )}
            {doerOpen && (
              <DoerBox
                state={state}
                taskId={task.id}
                onDecide={(doerId, replacedId) => {
                  const r = doneByEvents(engine.state, task.id, doerId, replacedId, engine.context());
                  if (r.events.length === 0) return;
                  engine.dispatch(r.events, r.label);
                  setDoerOpen(false);
                  window.setTimeout(() => (document.querySelector<HTMLElement>("[data-doer-open]") ?? document.getElementById("task-detail-title"))?.focus(), 0);
                }}
                onCancel={() => {
                  setDoerOpen(false);
                  window.setTimeout(() => document.querySelector<HTMLElement>("[data-doer-open]")?.focus(), 0);
                }}
              />
            )}

          </section>
        )}

        {engine && <SlotSection state={state} engine={engine} taskId={task.id} />}

        {engine && (
          <section aria-labelledby="d-ops" className="flex flex-wrap items-center gap-2">
            <h3 id="d-ops" className="basis-full text-[14px] font-bold text-[var(--cn-muted)]">
              時刻・中止
            </h3>
            <button type="button" onClick={() => shift(-30)} className="h-[44px] rounded-lg border border-[var(--cn-control-line)] px-3 text-[15px]">
              30分前へ
            </button>
            <button type="button" onClick={() => shift(30)} className="h-[44px] rounded-lg border border-[var(--cn-control-line)] px-3 text-[15px]">
              30分後へ
            </button>
            {!isBreak && (
              <button type="button" onClick={cancel} className="ml-auto h-[44px] rounded-lg border border-[var(--cn-control-line)] px-3 text-[15px]">
                この業務を中止
              </button>
            )}
          </section>
        )}

        {(task.scopeNote || task.outOfScopeNote) && (
          <section className="rounded-xl border-2 border-[var(--cn-accent)] p-3">
            {task.scopeNote && (
              <>
                <h3 className="text-[14px] font-bold text-[var(--cn-accent)]">お願いすること</h3>
                <p className="text-[15px]">{task.scopeNote}</p>
              </>
            )}
            {task.outOfScopeNote && (
              <>
                <h3 className="mt-2 text-[14px] font-bold text-[var(--cn-ink-soft)]">お願いしないこと</h3>
                <p className="text-[15px]">{task.outOfScopeNote}</p>
              </>
            )}
          </section>
        )}

        {targets.length > 0 && (
          <section aria-labelledby="d-targets">
            <h3 id="d-targets" className="mb-1.5 text-[14px] font-bold text-[var(--cn-muted)]">
              対象の方 {targets.length}人
            </h3>
            <ul className="flex flex-col divide-y divide-[var(--cn-grid)] rounded-xl border border-[var(--cn-border)]">
              {targets.map((r) => {
                const changed = task.targetTimes?.[r.id];
                const row = task.routineId ? sheetRowFor(state, r.id, task.routineId) : undefined;
                return (
                  <li key={r.id} className="flex flex-col gap-0.5 px-3 py-2">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[13px] text-[var(--cn-muted)]">{r.room}</span>
                      <span className="font-bold">{r.displayName}様</span>
                      {changed !== undefined && <span className="ml-auto text-[15px] font-bold">{clockLabel(changed)}</span>}
                    </div>
                    {row?.support && <p className="text-[14px] text-[var(--cn-ink-soft)]">サポート: {row.support}</p>}
                  </li>
                );
              })}
            </ul>
            {(Object.keys(task.targetTimes ?? {}).length > 0 || targets.some((r) => task.routineId && sheetRowFor(state, r.id, task.routineId)?.support)) && (
              <p className="mt-1.5 text-[14px] text-[var(--cn-muted)]">右の時刻は、いつもと違う時刻の方です。サポートは24時間シートから出しています。</p>
            )}
          </section>
        )}

        {task.procedure && task.procedure.length > 0 && (
          <section aria-labelledby="d-proc">
            <h3 id="d-proc" className="mb-1.5 text-[14px] font-bold text-[var(--cn-muted)]">
              この施設の手順
            </h3>
            <ol className="list-decimal pl-5 text-[15px]">
              {task.procedure.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ol>
          </section>
        )}
        {task.supplies && (
          <section>
            <h3 className="mb-1 text-[14px] font-bold text-[var(--cn-muted)]">物品の場所</h3>
            <p className="text-[15px]">{task.supplies}</p>
          </section>
        )}
        {task.contact && (
          <section>
            <h3 className="mb-1 text-[14px] font-bold text-[var(--cn-muted)]">困ったら</h3>
            <p className="text-[15px]">{task.contact}</p>
          </section>
        )}
      </div>
    </aside>
  );
}

/** 入れ替えの相手を選び、「こう変わります」を見てから決める。注意は止めずに一文 */
function SwapBox({
  state,
  taskId,
  staffId,
  picked,
  onPick,
  onDecide,
  onCancel,
  boxRef,
}: {
  state: State;
  taskId: ID;
  staffId: ID;
  picked: SwapChoice | null;
  onPick: (c: SwapChoice | null) => void;
  onDecide: () => void;
  onCancel: () => void;
  boxRef: React.RefObject<HTMLDivElement | null>;
}) {
  const me = state.staff[staffId];
  const clock = useNowMinutes();
  const today = useDefaultDate(state, "business");
  const date = state.tasks[taskId]?.date;
  // 過ぎた日はすべて終わった枠、まだ来ていない日は時刻で絞らない
  const now = today === null || clock === null || !date ? null : date < today ? 2 * 24 * 60 : date > today ? null : clock;
  const choices = swapChoices(state, taskId, staffId, now);
  const ctx = { newId: () => "preview", ts: "", batchId: "preview" };
  const preview = picked ? swapPreview(state, { taskId, staffId }, picked, ctx) : null;
  const decideRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (picked) decideRef.current?.focus();
  }, [picked]);
  if (!me) return null;
  return (
    <div
      ref={boxRef}
      role="group"
      aria-label={`${boardName(state, me.id)}さんの入れ替え`}
      className="mt-2 flex flex-col gap-2 rounded-xl border border-[var(--cn-border)] p-3"
      onKeyDown={(e) => {
        // Escape は内側（入れ替えの箱）から先に閉じる（ループ 20）
        if (e.key === "Escape") {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      {!preview ? (
        <>
          <p className="text-[15px] font-bold">{boardName(state, me.id)}さんと担当を入れ替える人</p>
          <p className="text-[14px] text-[var(--cn-ink-soft)]">同じ時間に別の業務の担当がある人です（右はその人のいまの担当）。空いている人を足すときは「＋ 担当を追加」から。</p>
          {choices.length === 0 ? (
            <p className="text-[15px] text-[var(--cn-ink-soft)]">この時間に重なるほかの業務の担当の人がいません。</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {choices.map((c) => {
                const t = state.tasks[c.taskId];
                const s = state.staff[c.staffId];
                if (!t || !s) return null;
                return (
                  <li key={`${c.taskId}:${c.staffId}`}>
                    <button
                      type="button"
                      data-choice={`${c.taskId}:${c.staffId}`}
                      onClick={() => onPick(c)}
                      className="flex min-h-[44px] w-full items-center gap-2 rounded-lg border border-[var(--cn-control-line)] px-3 py-1.5 text-left text-[15px]"
                    >
                      <span className="font-bold">{boardName(state, s.id)}さん</span>
                      <span className="text-[var(--cn-ink-soft)]">
                        いまの担当: {taskLabel(state, t)} {fmtRange(t.startMin, t.endMin)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <button type="button" onClick={onCancel} className="h-[44px] self-start rounded-lg border border-[var(--cn-control-line)] px-3 text-[15px]">
            やめる
          </button>
        </>
      ) : (
        <>
          <p className="text-[15px] font-bold">こう変わります</p>
          <ul id="swap-lines" className="flex flex-col gap-0.5 text-[15px]">
            {preview.lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          {preview.notes.length > 0 && (
            <ul id="swap-notes" className="flex flex-col gap-0.5 text-[14px]">
              {preview.notes.map((n) => (
                <li key={n}>
                  <span className="font-bold text-[var(--cn-short-ink)]">注意: </span>
                  {n}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <button ref={decideRef} type="button" onClick={onDecide} aria-describedby={preview.notes.length > 0 ? "swap-lines swap-notes" : "swap-lines"} className="h-[44px] rounded-lg bg-[var(--cn-accent)] px-4 text-[15px] font-bold text-white">
              この内容で入れ替える
            </button>
            <button
              type="button"
              onClick={() => {
                const back = picked ? `${picked.taskId}:${picked.staffId}` : "";
                onPick(null);
                requestAnimationFrame(() => (boxRef.current?.querySelector<HTMLElement>(`[data-choice="${back}"]`) ?? boxRef.current?.querySelector<HTMLElement>("li button"))?.focus());
              }}
              className="h-[44px] rounded-lg border border-[var(--cn-control-line)] px-3 text-[15px]">
              選び直す
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * やった人を変える（決定記録 0022）: 代わってもらった・担当未定のまま誰かがやった。
 * 選ぶと担当を付け替えて「終わった」の印を付ける（1 回で元に戻る）。注意は止めずに一文。
 */
function DoerBox({ state, taskId, onDecide, onCancel }: { state: State; taskId: ID; onDecide: (doerId: ID, replacedId: ID | undefined) => void; onCancel: () => void }) {
  const assignees = assigneesOf(state, taskId);
  const status = headcountStatus(state, taskId);
  const short = status.level === "unassigned" || status.level === "short";
  // 担当が 1 人で人数がそろっている枠はその人の代わり。担当が足りない枠・複数の枠は、代わりか、もう一人足すかを選ぶ（ループ 21）
  // 担当がいなければ「やった人を選ぶ」
  const initial: ID | "add" | undefined = assignees.length === 0 ? "add" : assignees.length === 1 && !short ? assignees[0].id : undefined;
  const [mode, setMode] = useState<ID | "add" | undefined>(initial);
  const [showOff, setShowOff] = useState(false);
  const needWho = mode === undefined;
  const replaced = mode && mode !== "add" ? mode : undefined;
  const choices = needWho ? [] : doerChoices(state, taskId, replaced);
  const on = choices.filter((c) => !c.off);
  const off = choices.filter((c) => c.off);
  const boxRef = useRef<HTMLDivElement>(null);
  // 誰の代わりかを選ぶ段は先頭のボタンへ。人を選ぶ段は見出しへ（1 回の Enter で決まらないように。ループ 21）
  useEffect(() => {
    if (needWho) boxRef.current?.querySelector<HTMLElement>("button")?.focus();
    else boxRef.current?.querySelector<HTMLElement>("#doer-title")?.focus();
  }, [needWho]);
  const who = replaced ? boardName(state, replaced) : undefined;
  const title = needWho ? (short ? "代わりにやったか、一緒にやったか" : "誰の代わりにやりましたか") : who ? `${who}さんの代わりにやった人` : assignees.length > 0 ? "一緒にやった人を足す" : "やった人を選ぶ";
  const item = (c: DoerChoice) => {
    const st = state.staff[c.staffId];
    return (
      <li key={c.staffId}>
        <button
          type="button"
          onClick={() => onDecide(c.staffId, replaced)}
          className="flex min-h-[44px] w-full flex-col items-start rounded-lg border border-[var(--cn-control-line)] px-3 py-1.5 text-left text-[15px]"
        >
          <span className="font-bold">{st ? boardName(state, st.id) : ""}さん</span>
          {c.notes[0] && (
            <span className="text-[14px] text-[var(--cn-ink-soft)]">
              {!c.notes[0].startsWith("夜勤明け") && <span className="font-bold text-[var(--cn-short-ink)]">注意: </span>}
              {c.notes[0]}
            </span>
          )}
        </button>
      </li>
    );
  };
  return (
    <div
      ref={boxRef}
      id="doer-box"
      role="group"
      aria-labelledby="doer-title"
      className="flex flex-col gap-2 rounded-xl border border-[var(--cn-border)] p-3"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <h4 id="doer-title" tabIndex={-1} className="text-[15px] font-bold outline-none focus-visible:ring-2 focus-visible:ring-[var(--cn-accent)]">
        {title}
      </h4>
      <p className="text-[14px] text-[var(--cn-ink-soft)]">元に戻せます。</p>
      {needWho ? (
        <div className="flex flex-wrap gap-2">
          {assignees.map((a) => (
            <button key={a.id} type="button" onClick={() => setMode(a.id)} className="h-[44px] rounded-lg border border-[var(--cn-control-line)] px-3 text-[15px]">
              {boardName(state, a.id)}さんの代わり
            </button>
          ))}
          {short && (
            <button type="button" onClick={() => setMode("add")} className="h-[44px] rounded-lg border border-[var(--cn-control-line)] px-3 text-[15px]">
              一緒にやった人を足す
            </button>
          )}
        </div>
      ) : choices.length === 0 ? (
        <p className="text-[15px]">選べる人がいません（この日の勤務表にいる人から選びます）。</p>
      ) : (
        <>
          {on.length > 0 ? <ul className="flex flex-col gap-1.5">{on.map(item)}</ul> : <p className="text-[15px]">この時間に勤務している人はいません。下の「ほかの人」から選べます。</p>}
          {off.length > 0 && (
            <>
              <button
                type="button"
                aria-expanded={showOff}
                onClick={() => setShowOff((v) => !v)}
                className="flex h-[44px] w-full items-center justify-between rounded-lg border border-[var(--cn-control-line)] px-3 text-left text-[15px]"
              >
                <span>ほかの人（勤務外・休み {off.length}）</span>
                <span aria-hidden="true">{showOff ? "▴" : "▾"}</span>
              </button>
              {showOff && <ul className="flex flex-col gap-1.5">{off.map(item)}</ul>}
            </>
          )}
        </>
      )}
      <button type="button" onClick={onCancel} className="h-[44px] self-start rounded-lg border border-[var(--cn-control-line)] px-3 text-[15px]">
        やめる
      </button>
    </div>
  );
}

/**
 * この業務の番（決定記録 0024）。いまの番の名前と「番を変える…」。番ごとにきょうの人と、業務の条件を持つか。
 * 条件を持つ人の番を上に。付け外しはきょうの担当を変えない（次の日からは「今日を業務表として保存」）。
 */
function SlotSection({ state, engine, taskId }: { state: State; engine: Engine; taskId: ID }) {
  const [open, setOpen] = useState(false);
  const task = state.tasks[taskId];
  if (!task) return null;
  const names = task.slotIds.map((id) => state.roleSlots[id]?.name).filter(Boolean);
  const choices = open ? slotChoices(state, taskId) : [];
  const toggle = (slotId: ID, on: boolean) => {
    const r = setTaskSlotEvents(engine.state, taskId, slotId, on, engine.context());
    if (r.events.length > 0) engine.dispatch(r.events, r.label);
  };
  const who = (p: { staffId: ID; ok: boolean; missing: string[] }) =>
    `${boardName(state, p.staffId)}${task.requiredTags.length === 0 ? "" : p.ok ? "（条件あり）" : `（条件「${p.missing.join("・")}」なし）`}`;
  return (
    <section aria-labelledby="d-slot" className="flex flex-col gap-1.5">
      <h3 id="d-slot" className="text-[14px] font-bold text-[var(--cn-muted)]">
        この業務の番
      </h3>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[15px]">{names.length > 0 ? names.join("・") : "決まっていません"}</span>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? "slot-list" : undefined}
          onClick={() => setOpen((v) => !v)}
          className="h-[44px] rounded-lg border border-[var(--cn-control-line)] px-3 text-[15px]"
        >
          番を変える…
        </button>
      </div>
      <p className="text-[14px] text-[var(--cn-ink-soft)]">
        番の人が「この内容で作る」でこの業務の担当になります（業務の条件を持たない人は付けません）。番を変えたら、⋯ →「今日を業務表として保存」で次の日から効きます。きょうの担当は変わりません。
        {task.requiredTags.length > 0 && ` この業務の条件: ${task.requiredTags.join("・")}（施設の設定）。`}
      </p>
      {open && (
        <ul id="slot-list" aria-label="番の一覧" className="flex flex-col divide-y divide-[var(--cn-grid)] rounded-xl border border-[var(--cn-border)]">
          {choices.map((c) => (
            <li key={c.slotId} className="flex items-center gap-2 px-3 py-1.5">
              <span className="min-w-0 flex-1">
                <span className="block font-bold">{c.name}</span>
                <span className="block text-[14px] text-[var(--cn-ink-soft)]">
                  {c.people.length > 0 ? `きょう: ${c.people.map(who).join("・")}` : "きょうは出勤なし"}
                </span>
              </span>
              <button
                type="button"
                aria-pressed={c.on}
                aria-label={`${c.name}をこの業務の番にする`}
                onClick={() => toggle(c.slotId, !c.on)}
                className={`h-[44px] shrink-0 rounded-lg border px-3 text-[15px] ${c.on ? "border-[var(--cn-accent)] bg-[var(--cn-accent-soft)] font-bold text-[var(--cn-accent)]" : "border-[var(--cn-control-line)]"}`}
              >
                {c.on ? `✓ ${c.name}` : `${c.name}にする`}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
