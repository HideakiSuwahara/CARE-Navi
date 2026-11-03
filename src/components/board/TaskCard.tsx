"use client";

import { headcountStatus } from "@/domain/checks";
import { fmtRange } from "@/domain/time";
import type { ID, State, TaskInstance } from "@/domain/types";
import { useStaffDrag } from "./dnd";

/**
 * 業務カード（docs/screens.md §0.3）。
 * 出すもの: 業務名（個別は様名つき）・時刻・一括の人数・担当チップ・未充足のときだけバッジ・「＋」。
 * 出さないもの: 区分名・場所・必要人数・条件（詳細パネルで見る）。
 * 休憩はバッジなし。カード全体を button にせず、中の名前・チップ・＋をそれぞれ button にする（入れ子にしない）。
 */
export type CardVariant = "normal" | "compact" | "mini" | "rail";

export function TaskCard({
  state,
  task,
  variant = "normal",
  onOpen,
  onAdd,
}: {
  state: State;
  task: TaskInstance;
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
  const compact = variant === "compact";
  const mini = variant === "mini";
  const rail = variant === "rail";

  const frame = isBreak
    ? "border border-dashed border-[var(--cn-break-line)] bg-[var(--cn-break-bg)]"
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
    <StaffChip key={id} taskId={task.id} staffId={staff!.id} surname={staff!.surname} firstTimer={firstTimer} onOpen={() => onOpen?.(task.id)} />
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
      <span className={`block truncate text-[15px] font-bold leading-6 ${isBreak ? "text-[var(--cn-break-ink)]" : ""}`}>{title}</span>
      {!mini && <span className="block truncate text-[14px] font-normal leading-5 text-[var(--cn-muted)]">{when}</span>}
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
      aria-label={`${title} ${fmtRange(task.startMin, task.endMin)}${short ? ` ${status.label}` : ""}`}
      className={`flex h-full gap-2 overflow-hidden rounded-[10px] px-2.5 py-1 shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${
        rail && !short ? "bg-[var(--cn-rail-bg)]" : ""
      } ${compact || mini ? "flex-row items-center" : "flex-col"} ${frame}`}
      data-task-id={task.id}
      data-level={isBreak ? "break" : status.level}
      data-badge={short ? status.label : undefined}
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
function StaffChip({ taskId, staffId, surname, firstTimer, onOpen }: { taskId: ID; staffId: ID; surname: string; firstTimer: boolean; onOpen: () => void }) {
  const { dragProps, setNodeRef, style, isDragging } = useStaffDrag(`chip:${taskId}:${staffId}`, { kind: "chip", staffId, fromTaskId: taskId });
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
      <span className={`inline-flex h-[28px] items-center gap-1 rounded-full border border-[var(--cn-accent)] bg-[var(--cn-accent-soft)] px-2.5 text-[14px] text-[var(--cn-accent)] ${isDragging ? "shadow-lg" : ""}`}>
        {surname}
        {firstTimer && <span className="rounded border border-[var(--cn-card-line)] bg-white px-1 text-[13px] text-[var(--cn-ink)]">初回</span>}
      </span>
    </button>
  );
}
