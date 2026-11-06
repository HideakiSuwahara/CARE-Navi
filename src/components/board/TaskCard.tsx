"use client";

import { canMarkDone, headcountStatus, UNFINISHED_GRACE_MIN } from "@/domain/checks";
import { fmtRange } from "@/domain/time";
import type { ID, State, TaskInstance } from "@/domain/types";
import { useStaffDrag } from "./dnd";

/**
 * 業務カード（docs/screens.md §0.3）。
 * 出すもの: 業務名（個別は様名つき）・時刻・一括の人数・担当チップ・未充足のときだけバッジ・「＋」。
 * 出さないもの: 区分名・場所・必要人数・条件（詳細パネルで見る）。
 * 休憩はバッジなし。カード全体を button にせず、中の名前・チップ・＋をそれぞれ button にする（入れ子にしない）。
 * 「終わった」の印がある枠は ✓ と薄い文字。時刻を過ぎて印が無い枠は通常の濃さのまま（data-unfinished。見出しの「終わっていない n 件」から飛ぶ）。決定記録 0010
 */
export type CardVariant = "normal" | "compact" | "mini" | "rail";

export function TaskCard({
  state,
  task,
  variant = "normal",
  onOpen,
  onAdd,
  now,
  instanceKey,
}: {
  state: State;
  task: TaskInstance;
  /** 同じ枠を複数の列に出すとき（横軸［利用者］）の見分け。チップのドラッグ ID に使う */
  instanceKey?: string;
  /** いまの時刻（分）。終わっていない枠の判定に使う。無ければ判定しない */
  now?: number | null;
  /** compact: 短い業務（1段に詰める）。rail: 見守りなど左の細い帯 */
  variant?: CardVariant;
  onOpen?: (taskId: string) => void;
  onAdd?: (taskId: string) => void;
}) {
  const status = headcountStatus(state, task.id);
  const isBreak = task.kind === "break";
  const targets = state.targets[task.id] ?? [];
  const resident = task.targetMode === "individual" && targets[0] ? state.residents[targets[0]] : undefined;
  const title = resident ? `${task.name} ${resident.surname}様` : task.name;
  const assignees = Object.values(state.assignments)
    .filter((a) => a.taskId === task.id)
    .map((a) => ({ id: a.id, staff: state.staff[a.staffId], firstTimer: Object.values(state.roster).some((r) => r.date === task.date && r.staffId === a.staffId && r.firstTimer) }))
    .filter((x) => x.staff);
  const short = !isBreak && (status.level === "unassigned" || status.level === "short");
  const done = !isBreak && Boolean(task.done);
  const unfinished = canMarkDone(task) && !done && now !== null && now !== undefined && task.endMin + UNFINISHED_GRACE_MIN <= now;
  const compact = variant === "compact";
  const mini = variant === "mini";
  const rail = variant === "rail";

  // 終わった印のある枠は灰色の地・点線の枠（決定記録 0017）。終わっていない白い枠が目立つ。状態は「✓ 終わった」の文字で
  const frame = isBreak
    ? "border border-dashed border-[var(--cn-break-line)] bg-[var(--cn-break-bg)]"
    : done
      ? "border border-dashed border-[var(--cn-control-line)] bg-[var(--cn-ground)] shadow-none"
      : short
      ? `border-2 ${status.level === "unassigned" ? "border-dashed" : ""} border-[var(--cn-alert-line)] bg-white`
      : "border border-[var(--cn-card-line)] bg-white";

  const badge = short ? (
    <span
      className={`inline-flex h-[28px] shrink-0 items-center rounded-md px-2 text-[14px] font-bold ${
        status.level === "unassigned" ? "bg-[var(--cn-unassigned-bg)] text-[var(--cn-unassigned-ink)]" : "bg-[var(--cn-short-bg)] text-[var(--cn-short-ink)]"
      }`}
    >
      {status.label}
    </span>
  ) : null;

  const chips = assignees.map(({ id, staff, firstTimer }) => (
    <StaffChip key={id} taskId={task.id} staffId={staff!.id} surname={staff!.surname} firstTimer={firstTimer} done={done} dragKey={instanceKey} onOpen={() => onOpen?.(task.id)} />
  ));

  const when = (
    <>
      {fmtRange(task.startMin, task.endMin)}
      {task.targetMode === "group" && targets.length > 0 && ` ・ ${targets.length}人`}
    </>
  );
  // 業務名のボタンは 2 行（名前・時刻）で高さ 44px。負のマージンで広げないので、隣の要素に押せる領域を取られない
  const titleButton = (
    <button
      type="button"
      onClick={() => onOpen?.(task.id)}
      data-card-title=""
      title={title}
      className={`block w-full min-w-[44px] max-w-full text-left hover:underline ${mini ? "flex min-h-[44px] items-center" : "min-h-[44px]"}`}
    >
      <span className={`block truncate text-[15px] font-bold leading-6 ${isBreak ? "text-[var(--cn-break-ink)]" : done ? "text-[var(--cn-muted)]" : ""}`}>
        {/* 2 行のカードは 2 行目に「✓ 終わった」と文字で。1 行のカードは ✓ と読み上げ用の文字 */}
        {done && mini && <span className="text-[var(--cn-accent)]">✓ 終わった ・ </span>}
        {title}
      </span>
      {!mini && (
        <span className="block truncate text-[14px] font-normal leading-5 text-[var(--cn-muted)]">
          {done && <span className="font-bold text-[var(--cn-accent)]">✓ 終わった ・ </span>}
          {when}
        </span>
      )}
    </button>
  );
  const plus = (
    <button
      type="button"
      onClick={() => onAdd?.(task.id)}
      aria-label={`${title} に担当を追加`}
      className="inline-flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-full border border-dashed border-[var(--cn-muted)] bg-white text-[20px] leading-none text-[var(--cn-ink)] hover:bg-[var(--cn-ground)]"
    >
      ＋
    </button>
  );

  return (
    <article
      aria-label={`${title} ${fmtRange(task.startMin, task.endMin)}${short ? ` ${status.label}` : ""}${done ? " 終わった" : ""}`}
      className={`flex h-full gap-2 overflow-hidden rounded-[10px] px-2.5 py-1 shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${
        rail && !short ? "bg-[var(--cn-rail-bg)]" : ""
      } ${compact || mini ? "flex-row items-center" : "flex-col"} ${frame}`}
      data-task-id={task.id}
      data-level={isBreak ? "break" : status.level}
      data-badge={short ? status.label : undefined}
      data-done={done ? "" : undefined}
      data-unfinished={unfinished ? "" : undefined}
    >
      {mini ? (
        <>
          {/* とても短い業務（15分など）: 1行。名前・担当（文字）・バッジ・＋ */}
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {titleButton}
            {badge ?? (
              <span className="min-w-0 truncate text-[14px] text-[var(--cn-accent)]">{assignees.map((a) => a.staff!.surname).join("・")}</span>
            )}
          </div>
          {plus}
        </>
      ) : compact ? (
        <>
          {/* 短い業務（2時間未満の高さ）: 1 行に 名前（2行）・バッジ・担当・＋。どれも高さ 44px で重ならない */}
          <div className="min-w-0 flex-1">{titleButton}</div>
          <div className="flex min-w-0 shrink items-center gap-1.5 overflow-hidden">
            {badge}
            {chips}
          </div>
          {plus}
        </>
      ) : (
        <>
          {/* ＋ は右上（短いカードと同じ右側）。担当チップは押せる高さ 44px のまま折り返す */}
          <div className="flex min-w-0 items-start gap-2">
            <div className="min-w-0 flex-1">{titleButton}</div>
            {plus}
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
            {badge}
            {chips}
          </div>
        </>
      )}
    </article>
  );
}

/** 担当チップ。ドラッグで別のカードへ移す／パレットへ戻すと外す。押すと業務の詳細（外すボタンがある） */
function StaffChip({
  taskId,
  staffId,
  surname,
  firstTimer,
  done,
  dragKey,
  onOpen,
}: {
  taskId: ID;
  staffId: ID;
  surname: string;
  firstTimer: boolean;
  done?: boolean;
  dragKey?: string;
  onOpen: () => void;
}) {
  const { dragProps, setNodeRef, style, isDragging } = useStaffDrag(`chip:${taskId}:${staffId}${dragKey ? `:${dragKey}` : ""}`, { kind: "chip", staffId, fromTaskId: taskId });
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...dragProps}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onOpen();
        }
      }}
      style={style}
      className={`inline-flex h-[44px] min-w-[44px] shrink-0 cursor-grab touch-none items-center ${isDragging ? "opacity-80" : ""}`}
      aria-label={`${surname}${firstTimer ? "（初回）" : ""}`}
      aria-roledescription="ドラッグできる担当"
    >
      <span
        className={`inline-flex h-[28px] items-center gap-1 rounded-full border px-2.5 text-[14px] ${
          done ? "border-[var(--cn-control-line)] bg-white text-[var(--cn-ink-soft)]" : "border-[var(--cn-accent)] bg-[var(--cn-accent-soft)] text-[var(--cn-accent)]"
        } ${isDragging ? "shadow-lg" : ""}`}
      >
        {surname}
        {firstTimer && <span className="rounded border border-[var(--cn-card-line)] bg-white px-1 text-[13px] text-[var(--cn-ink)]">初回</span>}
      </span>
    </button>
  );
}

/**
 * 横軸［利用者］で、何人かが対象の枠を方ごとの列に出すときの写し（決定記録 0017、ループ 14）。
 * - 押すと同じ詳細が開く（担当の追加・「終わった」の印はそこで）。担当は文字だけ、＋は出さない（Tab が列の数だけ増えないように）。
 * - 「終わった」の印は枠に 1 つ。この方の分が終わったとは限らないので、地は灰色にせず「✓ 枠に印（n人の枠）」と文字で。
 */
export function SharedTaskCard({ state, task, onOpen, columnName }: { state: State; task: TaskInstance; onOpen?: (taskId: string) => void; columnName: string }) {
  const status = headcountStatus(state, task.id);
  const n = (state.targets[task.id] ?? []).length;
  const names = Object.values(state.assignments)
    .filter((a) => a.taskId === task.id)
    .map((a) => state.staff[a.staffId]?.surname)
    .filter(Boolean)
    .join("・");
  const short = status.level === "unassigned" || status.level === "short";
  return (
    <article
      aria-label={`${task.name} ${fmtRange(task.startMin, task.endMin)}、${n}人の枠（${columnName}を含む）${short ? ` ${status.label}` : ""}${task.done ? " 枠に終わったの印" : ""}`}
      data-task-id={task.id}
      data-shared=""
      data-level={status.level}
      data-badge={short ? status.label : undefined}
      className={`h-full overflow-hidden rounded-[10px] border bg-white px-2 py-1 ${short ? "border-dashed border-[var(--cn-alert-line)]" : "border-[var(--cn-card-line)]"}`}
    >
      <button type="button" onClick={() => onOpen?.(task.id)} data-card-title="" title={`${task.name} ${fmtRange(task.startMin, task.endMin)}`} className="block min-h-[44px] w-full text-left hover:underline">
        <span className="line-clamp-2 break-words text-[14px] font-bold leading-5">{task.name}</span>
        <span className="block text-[13px] leading-5 text-[var(--cn-ink-soft)]">
          {fmtRange(task.startMin, task.endMin)} ・ {n}人の枠
        </span>
        <span className="block text-[13px] leading-5">
          {task.done ? <span className="font-bold text-[var(--cn-accent)]">✓ 枠に印 </span> : null}
          {short ? <span className="font-bold text-[var(--cn-unassigned-ink)]">{status.label}</span> : <span className="text-[var(--cn-accent)]">{names}</span>}
        </span>
      </button>
    </article>
  );
}
