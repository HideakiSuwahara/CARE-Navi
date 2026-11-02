/**
 * コマンド = UI の1操作を、イベントの列と「こう変わります」の行に変換する。
 * - 変更は10秒以内: すべてのコマンドは1つの batchId にまとまり、1回で元に戻せる。
 * - クイック操作（欠勤・早退／付き添い・外出を追加／ずらす／中止／担当を外す）は
 *   プレビュー（PreviewLine[]）を返し、人が確認してから適用する。
 * - 重なりで担当を外す提案は、ここで決定的に作る（推測しない）。
 */

import type { Event } from "./events.ts";
import { applyEvents } from "./reducer.ts";
import { metaOf, type EventContext } from "./pattern.ts";
import { assignmentsOf, headcountStatus, rosterOf, taskLabel, tasksOfStaff } from "./checks.ts";
import { fmtRange, overlaps } from "./time.ts";
import type { DateKey, ID, Minutes, State, TaskInstance } from "./types.ts";

export interface PreviewLine {
  kind: "add" | "remove" | "cancel" | "move" | "unassign" | "assign" | "effect";
  text: string;
  /** この行に対応するイベント。チェックを外すと適用しない。effect 行は空 */
  eventIds: ID[];
  /** 外せる行か（effect は外せない） */
  optional: boolean;
  /** 最初からチェックが入っているか。省略は true。候補として出すだけの行は false */
  defaultOn?: boolean;
}

export interface Preview {
  title: string;
  lines: PreviewLine[];
  events: Event[];
}

/** 最初にチェックを外しておく行のイベント（defaultOn: false の行） */
export function defaultUnchecked(preview: Preview): Set<ID> {
  return new Set(preview.lines.filter((l) => l.defaultOn === false).flatMap((l) => l.eventIds));
}

/** 選んだ行だけのイベントに絞る */
export function selectPreview(preview: Preview, uncheckedEventIds: Set<ID>): Event[] {
  return preview.events.filter((e) => !uncheckedEventIds.has(e.eventId));
}

/** 適用後に新しく「担当未定／担当あと n 人」になる業務を effect 行にする */
function effectsAfter(state: State, events: Event[], date: DateKey): PreviewLine[] {
  const after = applyEvents(state, events);
  const lines: PreviewLine[] = [];
  for (const t of Object.values(after.tasks)) {
    if (t.date !== date || t.status !== "planned") continue;
    const before = state.tasks[t.id] ? headcountStatus(state, t.id) : null;
    const now = headcountStatus(after, t.id);
    if ((now.level === "unassigned" || now.level === "short") && (!before || before.level !== now.level || before.assigned !== now.assigned)) {
      if (before && before.assigned <= now.assigned) continue;
      lines.push({
        kind: "effect",
        text: `「${taskLabel(after, t)} ${fmtRange(t.startMin, t.endMin)}」が 必要${now.required}・配置${now.assigned} になります（${now.label}）`,
        eventIds: [],
        optional: false,
      });
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------
// 基本操作
// ---------------------------------------------------------------------------

export function assignEvents(taskId: ID, staffId: ID, ctx: EventContext): Event[] {
  return [{ ...metaOf(ctx), type: "assignment.add", assignment: { id: ctx.newId(), taskId, staffId } }];
}

export function unassignEvents(state: State, taskId: ID, staffId: ID, ctx: EventContext): Event[] {
  return assignmentsOf(state, taskId)
    .filter((a) => a.staffId === staffId)
    .map((a) => ({ ...metaOf(ctx), type: "assignment.remove" as const, id: a.id }));
}

/** 担当を別の業務へ移す（カードからカードへ） */
export function moveAssignmentEvents(state: State, fromTaskId: ID, toTaskId: ID, staffId: ID, ctx: EventContext): Event[] {
  return [...unassignEvents(state, fromTaskId, staffId, ctx), ...assignEvents(toTaskId, staffId, ctx)];
}

export function cancelTaskEvents(taskId: ID, ctx: EventContext, note?: string): Event[] {
  return [{ ...metaOf(ctx), type: "task.update", id: taskId, patch: { status: "cancelled", ...(note ? { note } : {}) } }];
}

export function restoreTaskEvents(taskId: ID, ctx: EventContext): Event[] {
  return [{ ...metaOf(ctx), type: "task.update", id: taskId, patch: { status: "planned" } }];
}

/** ずらす（±15/30/60 分、または時刻入力）。長さは保つ */
export function shiftTaskEvents(state: State, taskId: ID, deltaMin: Minutes, ctx: EventContext): Event[] {
  const t = state.tasks[taskId];
  if (!t) return [];
  return [
    { ...metaOf(ctx), type: "task.update", id: taskId, patch: { startMin: t.startMin + deltaMin, endMin: t.endMin + deltaMin } },
  ];
}

export function setTaskTimeEvents(taskId: ID, startMin: Minutes, endMin: Minutes, ctx: EventContext): Event[] {
  return [{ ...metaOf(ctx), type: "task.update", id: taskId, patch: { startMin, endMin } }];
}

// ---------------------------------------------------------------------------
// クイック操作（プレビュー付き。スマホで3タップ以内: ボタン → 選ぶ → 決定）
// 決定記録 0003 §3・§5: 既定値を入れておく。休憩は外さず後ろへずらす。
// ---------------------------------------------------------------------------

/** 15分単位で切り上げ */
function ceil15(min: Minutes): Minutes {
  return Math.ceil(min / 15) * 15;
}

/** 付き添いの既定の時間帯: 今から（15分単位に切り上げ）90分 */
export function defaultEscortRange(nowMin: Minutes, durationMin: Minutes = 90): { startMin: Minutes; endMin: Minutes } {
  const startMin = ceil15(nowMin);
  return { startMin, endMin: startMin + durationMin };
}

/**
 * 休憩と重なったときの「ずらし先」を決める（決定的）。
 * 1. その人の他の予定と重ならない、後ろの休憩カードがあればそこへ移る
 * 2. なければ、付き添い等の終わりから同じ長さの「休憩」を新しく作る
 */
function relocateBreak(
  state: State,
  staffId: ID,
  brk: TaskInstance,
  blockEndMin: Minutes,
  busy: { startMin: Minutes; endMin: Minutes }[],
  ctx: EventContext,
): { events: Event[]; text: string } {
  const name = state.staff[staffId]?.surname ?? "";
  const length = brk.endMin - brk.startMin;
  const myTasks = tasksOfStaff(state, brk.date, staffId).filter((t) => t.id !== brk.id);
  const free = (s: Minutes, e: Minutes) =>
    !myTasks.some((t) => overlaps(s, e, t.startMin, t.endMin)) && !busy.some((b) => overlaps(s, e, b.startMin, b.endMin));
  const removeEvs = unassignEvents(state, brk.id, staffId, ctx);

  const later = Object.values(state.tasks)
    .filter((t) => t.date === brk.date && t.kind === "break" && t.status === "planned" && t.id !== brk.id && t.startMin >= blockEndMin)
    .sort((a, b) => a.startMin - b.startMin)
    .find((t) => free(t.startMin, t.endMin) && !assignmentsOf(state, t.id).some((a) => a.staffId === staffId));
  if (later) {
    return {
      events: [...removeEvs, ...assignEvents(later.id, staffId, ctx)],
      text: `ずらす: ${name} の休憩 ${fmtRange(brk.startMin, brk.endMin)} → 「${later.name}」${fmtRange(later.startMin, later.endMin)}`,
    };
  }

  let start = ceil15(blockEndMin);
  while (!free(start, start + length) && start + length < 2880) start += 15;
  const taskId = ctx.newId();
  const own: TaskInstance = {
    ...brk,
    id: taskId,
    name: `休憩（${name}）`,
    startMin: start,
    endMin: start + length,
    headcount: 1,
    slotIds: [],
    origin: "manual",
  };
  return {
    events: [
      ...removeEvs,
      { ...metaOf(ctx), type: "task.add", task: own, residentIds: [] },
      ...assignEvents(taskId, staffId, ctx),
    ],
    text: `ずらす: ${name} の休憩 ${fmtRange(brk.startMin, brk.endMin)} → ${fmtRange(start, start + length)}`,
  };
}

export interface EscortInput {
  date: DateKey;
  residentId: ID;
  /** 既定: 受診の付き添い */
  name?: string;
  /** 既定: defaultEscortRange(nowMin) */
  startMin: Minutes;
  endMin: Minutes;
  /** 任意。空なら担当未定で作る（プレビューで付けられる） */
  staffId?: ID;
  templateId?: ID;
  groupId?: ID;
  place?: string;
}

export const ESCORT_NAMES = ["受診の付き添い", "外出の付き添い", "入院の付き添い", "その他の付き添い"] as const;

/**
 * 付き添い・外出を追加。
 * - 個別業務を1件足す（担当は任意）
 * - 担当者の重なる業務からは外す（外せる行）。重なる休憩は外さず後ろへずらす
 * - 同じ利用者の同じ時間の個別業務は「中止」の候補として出す（最初はチェックなし）
 */
export function escortPreview(state: State, input: EscortInput, ctx: EventContext): Preview {
  const name = input.name ?? ESCORT_NAMES[0];
  const staff = input.staffId ? state.staff[input.staffId] : undefined;
  const resident = state.residents[input.residentId];
  const tpl = input.templateId ? state.templates[input.templateId] : undefined;
  const taskId = ctx.newId();
  const task: TaskInstance = {
    id: taskId,
    date: input.date,
    templateId: tpl?.id,
    name,
    kind: "care",
    categoryId: tpl?.categoryId ?? "core",
    targetMode: "individual",
    groupId: input.groupId ?? resident?.groupId,
    startMin: input.startMin,
    endMin: input.endMin,
    place: input.place ?? tpl?.place,
    headcount: 1,
    requiredTags: tpl ? [...tpl.requiredTags] : [],
    slotIds: [],
    scopeNote: tpl?.scopeNote,
    outOfScopeNote: tpl?.outOfScopeNote,
    procedure: tpl?.procedure ? [...tpl.procedure] : undefined,
    supplies: tpl?.supplies,
    contact: tpl?.contact,
    status: "planned",
    origin: "manual",
  };

  const events: Event[] = [];
  const lines: PreviewLine[] = [];
  const addEv: Event = { ...metaOf(ctx), type: "task.add", task, residentIds: [input.residentId] };
  events.push(addEv);
  const addIds = [addEv.eventId];
  if (input.staffId) {
    const asg = assignEvents(taskId, input.staffId, ctx);
    events.push(...asg);
    addIds.push(...asg.map((e) => e.eventId));
  }
  lines.push({
    kind: "add",
    text: `追加: ${name} ${resident ? `${resident.surname}様` : ""} ${fmtRange(input.startMin, input.endMin)}${staff ? ` → 担当 ${staff.surname}` : ""}`,
    eventIds: addIds,
    optional: false,
  });

  if (input.staffId) {
    for (const t of tasksOfStaff(state, input.date, input.staffId)) {
      if (!overlaps(input.startMin, input.endMin, t.startMin, t.endMin)) continue;
      if (t.kind === "break") {
        const moved = relocateBreak(state, input.staffId, t, input.endMin, [{ startMin: input.startMin, endMin: input.endMin }], ctx);
        events.push(...moved.events);
        lines.push({ kind: "move", text: moved.text, eventIds: moved.events.map((e) => e.eventId), optional: true });
        continue;
      }
      for (const ev of unassignEvents(state, t.id, input.staffId, ctx)) {
        events.push(ev);
        lines.push({
          kind: "unassign",
          text: `外す: ${staff?.surname ?? ""} → 「${taskLabel(state, t)} ${fmtRange(t.startMin, t.endMin)}」（付き添いと重なるため）`,
          eventIds: [ev.eventId],
          optional: true,
        });
      }
    }
  }

  // 同じ利用者の同じ時間の個別業務（入浴など）は中止の候補
  for (const t of Object.values(state.tasks)) {
    if (t.date !== input.date || t.status !== "planned" || t.targetMode !== "individual") continue;
    if (!(state.targets[t.id] ?? []).includes(input.residentId)) continue;
    if (!overlaps(input.startMin, input.endMin, t.startMin, t.endMin)) continue;
    const evs = cancelTaskEvents(t.id, ctx, `${name}のため`);
    events.push(...evs);
    lines.push({
      kind: "cancel",
      text: `中止: 「${taskLabel(state, t)} ${fmtRange(t.startMin, t.endMin)}」（同じ時間のため）`,
      eventIds: evs.map((e) => e.eventId),
      optional: true,
      defaultOn: false,
    });
  }

  const preview: Preview = { title: "付き添い・外出", lines, events };
  preview.lines.push(...effectsAfter(state, selectPreview(preview, defaultUnchecked(preview)), input.date));
  return preview;
}

/**
 * 欠勤・早退。nowMin が勤務開始前（または未指定）なら欠勤、勤務中なら今の時刻（15分切り上げ）で早退。
 * 本日の残りの担当をすべて外し、空く枠を示す。
 */
export function absencePreview(state: State, date: DateKey, staffId: ID, ctx: EventContext, nowMin?: Minutes): Preview {
  const staff = state.staff[staffId];
  const entry = rosterOf(state, date, staffId);
  const name = staff?.surname ?? "職員";
  const leaveAtMin = entry && nowMin !== undefined && nowMin > entry.startMin && nowMin < entry.endMin ? ceil15(nowMin) : undefined;
  const lines: PreviewLine[] = [];
  const events: Event[] = [];

  if (entry) {
    const updated = leaveAtMin === undefined ? { ...entry, absent: true } : { ...entry, endMin: leaveAtMin };
    const ev: Event = { ...metaOf(ctx), type: "roster.upsert", entry: updated };
    events.push(ev);
    lines.push({
      kind: "move",
      text: leaveAtMin === undefined ? `${name} を本日「欠勤」にする` : `${name} の勤務を ${fmtRange(entry.startMin, leaveAtMin)} にする（早退）`,
      eventIds: [ev.eventId],
      optional: false,
    });
  }

  for (const t of tasksOfStaff(state, date, staffId)) {
    if (leaveAtMin !== undefined && t.endMin <= leaveAtMin) continue;
    for (const ev of unassignEvents(state, t.id, staffId, ctx)) {
      events.push(ev);
      lines.push({
        kind: "unassign",
        text: `外す: ${name} → 「${taskLabel(state, t)} ${fmtRange(t.startMin, t.endMin)}」`,
        eventIds: [ev.eventId],
        optional: t.kind === "break" ? false : true,
      });
    }
  }

  lines.push(...effectsAfter(state, events, date));
  return { title: leaveAtMin === undefined ? "欠勤" : "早退", lines, events };
}

/** 休憩をずらす（既定 +30分）。重なる人を知らせる */
export function shiftBreakPreview(state: State, taskId: ID, deltaMin: Minutes, ctx: EventContext): Preview {
  const t = state.tasks[taskId];
  if (!t) return { title: "休憩をずらす", lines: [], events: [] };
  const events = shiftTaskEvents(state, taskId, deltaMin, ctx);
  const lines: PreviewLine[] = [
    {
      kind: "move",
      text: `「${t.name}」を ${fmtRange(t.startMin, t.endMin)} → ${fmtRange(t.startMin + deltaMin, t.endMin + deltaMin)} にする`,
      eventIds: events.map((e) => e.eventId),
      optional: false,
    },
  ];
  for (const a of assignmentsOf(state, taskId)) {
    const others = tasksOfStaff(state, t.date, a.staffId).filter(
      (o) => o.id !== taskId && overlaps(t.startMin + deltaMin, t.endMin + deltaMin, o.startMin, o.endMin),
    );
    for (const o of others) {
      lines.push({
        kind: "effect",
        text: `${state.staff[a.staffId]?.surname ?? ""} は「${taskLabel(state, o)} ${fmtRange(o.startMin, o.endMin)}」と重なります`,
        eventIds: [],
        optional: false,
      });
    }
  }
  return { title: "休憩をずらす", lines, events };
}
