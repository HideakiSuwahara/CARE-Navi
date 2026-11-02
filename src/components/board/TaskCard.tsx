"use client";

import { headcountStatus } from "@/domain/checks";
import { fmtRange } from "@/domain/time";
import type { State, TaskInstance } from "@/domain/types";

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
    <button
      key={id}
      type="button"
      className="relative inline-flex h-[28px] shrink-0 items-center gap-1 rounded-full border border-[var(--cn-accent)] bg-[var(--cn-accent-soft)] px-2.5 text-[14px] text-[var(--cn-accent)] before:absolute before:-inset-y-[8px] before:inset-x-0 before:content-['']"
      aria-label={`${staff!.surname}${firstTimer ? "（初回）" : ""}`}
    >
      {staff!.surname}
      {firstTimer && <span className="rounded border border-[var(--cn-card-line)] bg-white px-1 text-[12px] text-[var(--cn-ink)]">初回</span>}
    </button>
  ));

  const titleButton = (
    <button
      type="button"
      onClick={() => onOpen?.(task.id)}
      className={`-my-[10px] block min-h-[44px] min-w-0 truncate py-[10px] text-left text-[15px] font-bold leading-6 hover:underline ${
        isBreak ? "text-[var(--cn-break-ink)]" : ""
      }`}
    >
      {title}
    </button>
  );
  const when = (
    <>
      {fmtRange(task.startMin, task.endMin)}
      {task.targetMode === "group" && targets.length > 0 && ` ・ ${targets.length}人`}
    </>
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
      className={`flex h-full gap-2 overflow-hidden rounded-[10px] px-2.5 py-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${
        rail && !short ? "bg-[var(--cn-rail-bg)]" : ""
      } ${frame} ${compact || mini ? "flex-row items-center" : "flex-col"}`}
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
              <span className="min-w-0 truncate text-[13px] text-[var(--cn-accent)]">{assignees.map((a) => a.staff!.surname).join("・")}</span>
            )}
          </div>
          {plus}
        </>
      ) : compact ? (
        <>
          {/* 短い業務（2時間未満の高さ）: 左に 名前・時刻／バッジ・担当、右に ＋。状態（バッジ）を先に出して切らさない */}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex min-w-0 items-baseline gap-2">
              {titleButton}
              <span className="shrink-0 whitespace-nowrap text-[13px] text-[var(--cn-muted)]">{when}</span>
            </div>
            <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
              {badge}
              {chips}
            </div>
          </div>
          {plus}
        </>
      ) : (
        <>
          <div className="flex min-w-0 flex-col">
            {titleButton}
            <span className="truncate text-[13px] leading-5 text-[var(--cn-muted)]">{when}</span>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {badge}
            {chips}
          </div>
          <div className="mt-auto flex justify-end">{plus}</div>
        </>
      )}
    </article>
  );
}
