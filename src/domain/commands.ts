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
}

export interface Preview {
  title: string;
  lines: PreviewLine[];
  events: Event[];
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
// クイック操作（プレビュー付き）
// ---------------------------------------------------------------------------

/** 欠勤・早退: 本日の担当をすべて外し、空く枠を見せる。早退は endMin を指定 */
export function absencePreview(state: State, date: DateKey, staffId: ID, ctx: EventContext, leaveAtMin?: Minutes): Preview {
  const staff = state.staff[staffId];
  const entry = rosterOf(state, date, staffId);
  const name = staff?.surname ?? "職員";
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
        optional: true,
      });
    }
  }

  lines.push(...effectsAfter(state, events, date));
  return { title: leaveAtMin === undefined ? "欠勤" : "早退", lines, events };
}

export interface EscortInput {
  date: DateKey;
  /** 業務名。例: 受診の付き添い、外出の付き添い */
  name: string;
  residentId: ID;
  startMin: Minutes;
  endMin: Minutes;
  staffId: ID;
  templateId?: ID;
  groupId?: ID;
  place?: string;
}

/** 付き添い・外出を追加: 個別業務を1件足し、担当を付け、重なる担当を外す提案を添える */
export function escortPreview(state: State, input: EscortInput, ctx: EventContext): Preview {
  const staff = state.staff[input.staffId];
  const resident = state.residents[input.residentId];
  const tpl = input.templateId ? state.templates[input.templateId] : undefined;
  const taskId = ctx.newId();
  const task: TaskInstance = {
    id: taskId,
    date: input.date,
    templateId: tpl?.id,
    name: input.name,
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
  const asgEv: Event = { ...metaOf(ctx), type: "assignment.add", assignment: { id: ctx.newId(), taskId, staffId: input.staffId } };
  events.push(addEv, asgEv);
  lines.push({
    kind: "add",
    text: `追加: ${input.name} ${resident ? `${resident.surname}様` : ""} ${fmtRange(input.startMin, input.endMin)} → 担当 ${staff?.surname ?? ""}`,
    eventIds: [addEv.eventId, asgEv.eventId],
    optional: false,
  });

  // 重なる担当を外す提案（決定的）
  for (const t of tasksOfStaff(state, input.date, input.staffId)) {
    if (!overlaps(input.startMin, input.endMin, t.startMin, t.endMin)) continue;
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

  lines.push(...effectsAfter(state, events, input.date));
  return { title: "付き添い・外出を追加", lines, events };
}

/** 休憩をずらす: 休憩カードの時刻を変え、重なる担当を知らせる */
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
  // ずらした先で重なる人を知らせる（外しはしない。人が決める）
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
