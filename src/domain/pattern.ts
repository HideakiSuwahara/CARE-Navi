/**
 * 一日の型（役割表）→ 当日の業務予定と担当。
 * 「朝は人に役割を付けるだけ」: 役割枠に束ねた業務へ、当日その役割の出勤者が担当として入る。
 */

import type { Event } from "./events.ts";
import { rosterForDate, tasksForDate } from "./checks.ts";
import type { DateKey, DayPattern, DayPatternItem, ID, State, TaskInstance } from "./types.ts";

export interface EventContext {
  newId: () => ID;
  ts: string;
  batchId: ID;
  actorId?: ID;
}

export function metaOf(ctx: EventContext): { eventId: ID; ts: string; batchId: ID; actorId?: ID } {
  return { eventId: ctx.newId(), ts: ctx.ts, batchId: ctx.batchId, actorId: ctx.actorId };
}

function residentsForItem(state: State, item: DayPatternItem): ID[] {
  if (item.targetRule === "none") return [];
  if (item.targetRule === "residents") return [...(item.residentIds ?? [])];
  if (!item.groupId) return [];
  return Object.values(state.residents)
    .filter((r) => r.groupId === item.groupId)
    .sort((a, b) => a.room.localeCompare(b.room, "ja"))
    .map((r) => r.id);
}

/** 役割枠 → 当日の出勤者（欠勤を除く） */
export function staffForSlots(state: State, date: DateKey, slotIds: ID[]): ID[] {
  const out: ID[] = [];
  for (const entry of rosterForDate(state, date)) {
    if (entry.absent || !entry.slotId) continue;
    if (slotIds.includes(entry.slotId) && !out.includes(entry.staffId)) out.push(entry.staffId);
  }
  return out;
}

export function taskFromPatternItem(state: State, date: DateKey, item: DayPatternItem, id: ID): TaskInstance | null {
  const tpl = state.templates[item.templateId];
  if (!tpl) return null;
  return {
    id,
    date,
    templateId: tpl.id,
    name: tpl.name,
    kind: tpl.kind,
    categoryId: tpl.categoryId,
    targetMode: tpl.targetMode,
    groupId: item.groupId,
    startMin: item.startMin,
    endMin: item.endMin,
    place: tpl.place,
    headcount: item.headcount,
    requiredTags: [...tpl.requiredTags],
    slotIds: [...item.slotIds],
    scopeNote: tpl.scopeNote,
    outOfScopeNote: tpl.outOfScopeNote,
    procedure: tpl.procedure ? [...tpl.procedure] : undefined,
    supplies: tpl.supplies,
    contact: tpl.contact,
    status: "planned",
    origin: "pattern",
  };
}

/**
 * 型を当てる。すでに型から作られた当日の予定（origin = pattern）は作り直す。
 * 手で足した予定（origin なし／manual）は残す。
 */
export function applyPatternEvents(state: State, date: DateKey, patternId: ID, ctx: EventContext): Event[] {
  const pattern = state.patterns[patternId];
  if (!pattern) return [];
  const events: Event[] = [];

  for (const t of tasksForDate(state, date, true)) {
    if (t.origin === "pattern") events.push({ ...metaOf(ctx), type: "task.remove", id: t.id });
  }

  for (const item of pattern.items) {
    const taskId = ctx.newId();
    const task = taskFromPatternItem(state, date, item, taskId);
    if (!task) continue;
    events.push({ ...metaOf(ctx), type: "task.add", task, residentIds: residentsForItem(state, item) });
    for (const staffId of staffForSlots(state, date, item.slotIds)) {
      events.push({ ...metaOf(ctx), type: "assignment.add", assignment: { id: ctx.newId(), taskId, staffId } });
    }
  }
  events.push({ ...metaOf(ctx), type: "day.setPattern", date, patternId });
  return events;
}

/**
 * 今日の形を型として保存する。人（担当）は保存せず、業務・時刻・対象の決め方・必要人数・役割枠だけを残す。
 */
export function patternFromDay(state: State, date: DateKey, name: string, ctx: EventContext): DayPattern | null {
  const items: DayPatternItem[] = [];
  for (const t of tasksForDate(state, date)) {
    if (!t.templateId) continue;
    const targetIds = state.targets[t.id] ?? [];
    let targetRule: DayPatternItem["targetRule"] = "none";
    let residentIds: ID[] | undefined;
    if (t.targetMode !== "none" && targetIds.length > 0) {
      const groupAll = t.groupId
        ? Object.values(state.residents)
            .filter((r) => r.groupId === t.groupId)
            .map((r) => r.id)
        : [];
      const isAll =
        groupAll.length > 0 && groupAll.length === targetIds.length && groupAll.every((id) => targetIds.includes(id));
      targetRule = isAll ? "allInGroup" : "residents";
      residentIds = isAll ? undefined : [...targetIds];
    }
    items.push({
      id: ctx.newId(),
      templateId: t.templateId,
      startMin: t.startMin,
      endMin: t.endMin,
      groupId: t.groupId,
      targetRule,
      residentIds,
      headcount: t.headcount,
      slotIds: [...t.slotIds],
    });
  }
  if (items.length === 0) return null;
  return { id: ctx.newId(), name, items };
}

/** 役割枠を持ち替える（A番を 佐藤 → 高橋）。その役割に束ねた当日の業務の担当を付け替えるイベント。 */
export function reassignSlotEvents(
  state: State,
  date: DateKey,
  slotId: ID,
  fromStaffId: ID | undefined,
  toStaffId: ID | undefined,
  ctx: EventContext,
): Event[] {
  const events: Event[] = [];
  for (const t of tasksForDate(state, date)) {
    if (!t.slotIds.includes(slotId)) continue;
    if (fromStaffId) {
      for (const a of Object.values(state.assignments)) {
        if (a.taskId === t.id && a.staffId === fromStaffId) {
          events.push({ ...metaOf(ctx), type: "assignment.remove", id: a.id });
        }
      }
    }
    if (toStaffId) {
      const already = Object.values(state.assignments).some((a) => a.taskId === t.id && a.staffId === toStaffId);
      if (!already) {
        events.push({
          ...metaOf(ctx),
          type: "assignment.add",
          assignment: { id: ctx.newId(), taskId: t.id, staffId: toStaffId },
        });
      }
    }
  }
  return events;
}
