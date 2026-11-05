/**
 * リデューサ: イベント → 状態。決定的で副作用なし。
 * 状態は浅いコピーで更新する（変更した部分だけ新しいオブジェクト）。
 */

import type { Event } from "./events.ts";
import { emptyState, type Assignment, type DateKey, type ID, type State } from "./types.ts";

function touchDay(state: State, date: DateKey, ts: string): State {
  const prev = state.days[date];
  return {
    ...state,
    days: { ...state.days, [date]: { date, appliedPatternId: prev?.appliedPatternId, updatedAt: ts } },
  };
}

function omit<T>(rec: Record<ID, T>, id: ID): Record<ID, T> {
  if (!(id in rec)) return rec;
  const next = { ...rec };
  delete next[id];
  return next;
}

export function reduce(state: State, ev: Event): State {
  switch (ev.type) {
    case "facility.set":
      return { ...state, facility: ev.facility };

    case "group.upsert":
      return { ...state, groups: { ...state.groups, [ev.group.id]: ev.group } };
    case "group.remove":
      return { ...state, groups: omit(state.groups, ev.id) };

    case "resident.upsert":
      return { ...state, residents: { ...state.residents, [ev.resident.id]: ev.resident } };
    case "resident.remove": {
      const targets: Record<ID, ID[]> = {};
      for (const [taskId, ids] of Object.entries(state.targets)) {
        // fromDate より前の枠は履歴として残す（退所した方も、その日の対象だった事実は変えない）
        const keep = ev.fromDate !== undefined && (state.tasks[taskId]?.date ?? "") < ev.fromDate;
        targets[taskId] = keep ? ids : ids.filter((r) => r !== ev.id);
      }
      return { ...state, residents: omit(state.residents, ev.id), targets };
    }

    case "staff.upsert":
      return { ...state, staff: { ...state.staff, [ev.staff.id]: ev.staff } };
    case "staff.remove":
      return { ...state, staff: omit(state.staff, ev.id) };

    case "roleSlot.upsert":
      return { ...state, roleSlots: { ...state.roleSlots, [ev.roleSlot.id]: ev.roleSlot } };
    case "roleSlot.remove":
      return { ...state, roleSlots: omit(state.roleSlots, ev.id) };

    case "template.upsert":
      return { ...state, templates: { ...state.templates, [ev.template.id]: ev.template } };
    case "template.remove":
      return { ...state, templates: omit(state.templates, ev.id) };

    case "pattern.upsert":
      return { ...state, patterns: { ...state.patterns, [ev.pattern.id]: ev.pattern } };
    case "pattern.remove":
      return { ...state, patterns: omit(state.patterns, ev.id) };

    case "roster.upsert": {
      const next = { ...state, roster: { ...state.roster, [ev.entry.id]: ev.entry } };
      return touchDay(next, ev.entry.date, ev.ts);
    }
    case "roster.remove": {
      const prev = state.roster[ev.id];
      const next = { ...state, roster: omit(state.roster, ev.id) };
      return prev ? touchDay(next, prev.date, ev.ts) : next;
    }

    case "task.add": {
      const next = {
        ...state,
        tasks: { ...state.tasks, [ev.task.id]: ev.task },
        targets: { ...state.targets, [ev.task.id]: [...ev.residentIds] },
      };
      return touchDay(next, ev.task.date, ev.ts);
    }
    case "task.remove": {
      const prev = state.tasks[ev.id];
      if (!prev) return state;
      const assignments: Record<ID, Assignment> = {};
      for (const a of Object.values(state.assignments)) {
        if (a.taskId !== ev.id) assignments[a.id] = a;
      }
      const next = {
        ...state,
        tasks: omit(state.tasks, ev.id),
        targets: omit(state.targets, ev.id),
        assignments,
      };
      return touchDay(next, prev.date, ev.ts);
    }
    case "task.update": {
      const prev = state.tasks[ev.id];
      if (!prev) return state;
      const next = { ...state, tasks: { ...state.tasks, [ev.id]: { ...prev, ...ev.patch } } };
      return touchDay(next, prev.date, ev.ts);
    }
    case "task.setTargets": {
      const prev = state.tasks[ev.id];
      if (!prev) return state;
      const next = { ...state, targets: { ...state.targets, [ev.id]: [...ev.residentIds] } };
      return touchDay(next, prev.date, ev.ts);
    }
    case "task.done": {
      const prev = state.tasks[ev.id];
      if (!prev) return state;
      const next = { ...state, tasks: { ...state.tasks, [ev.id]: { ...prev, done: ev.done } } };
      return touchDay(next, prev.date, ev.ts);
    }

    case "assignment.add": {
      const task = state.tasks[ev.assignment.taskId];
      // 同じ職員を同じ業務へ二重登録しない（リデューサでも守る）
      const dup = Object.values(state.assignments).some(
        (a) => a.taskId === ev.assignment.taskId && a.staffId === ev.assignment.staffId,
      );
      if (dup) return state;
      const next = { ...state, assignments: { ...state.assignments, [ev.assignment.id]: ev.assignment } };
      return task ? touchDay(next, task.date, ev.ts) : next;
    }
    case "assignment.remove": {
      const byId = state.assignments[ev.id];
      const prev =
        byId ?? (ev.taskId && ev.staffId ? Object.values(state.assignments).find((a) => a.taskId === ev.taskId && a.staffId === ev.staffId) : undefined);
      if (!prev) return state;
      const task = state.tasks[prev.taskId];
      const next = { ...state, assignments: omit(state.assignments, prev.id) };
      return task ? touchDay(next, task.date, ev.ts) : next;
    }

    case "day.setPattern":
      return {
        ...state,
        days: { ...state.days, [ev.date]: { date: ev.date, appliedPatternId: ev.patternId, updatedAt: ev.ts } },
      };

    case "sheet.upsert":
      return { ...state, sheets: { ...state.sheets, [ev.sheet.residentId]: ev.sheet } };

    default:
      return state;
  }
}

export function applyEvents(state: State, events: Iterable<Event>): State {
  let s = state;
  for (const ev of events) s = reduce(s, ev);
  return s;
}

export function stateFromEvents(events: Iterable<Event>): State {
  return applyEvents(emptyState(), events);
}

/**
 * 打ち消しイベントを作る（Undo）。
 * before は「そのイベントを適用する直前の状態」。戻せないものは空配列。
 * 返るイベントの id/ts/batchId は呼び出し側が付け直す（meta は仮）。
 */
export function invertEvent(ev: Event, before: State): Event[] {
  const meta = { eventId: `undo-${ev.eventId}`, ts: ev.ts, batchId: `undo-${ev.batchId}`, actorId: ev.actorId };
  switch (ev.type) {
    case "facility.set":
      return before.facility ? [{ ...meta, type: "facility.set", facility: before.facility }] : [];
    case "group.upsert": {
      const prev = before.groups[ev.group.id];
      return prev ? [{ ...meta, type: "group.upsert", group: prev }] : [{ ...meta, type: "group.remove", id: ev.group.id }];
    }
    case "group.remove": {
      const prev = before.groups[ev.id];
      return prev ? [{ ...meta, type: "group.upsert", group: prev }] : [];
    }
    case "resident.upsert": {
      const prev = before.residents[ev.resident.id];
      return prev
        ? [{ ...meta, type: "resident.upsert", resident: prev }]
        : [{ ...meta, type: "resident.remove", id: ev.resident.id }];
    }
    case "resident.remove": {
      const prev = before.residents[ev.id];
      if (!prev) return [];
      // 対象者からも外れているので、戻すときは対象の一覧も戻す
      const out: Event[] = [{ ...meta, type: "resident.upsert", resident: prev }];
      for (const [taskId, ids] of Object.entries(before.targets)) {
        if (!ids.includes(ev.id)) continue;
        if (ev.fromDate !== undefined && (before.tasks[taskId]?.date ?? "") < ev.fromDate) continue;
        out.push({ ...meta, type: "task.setTargets", id: taskId, residentIds: [...ids] });
      }
      return out;
    }
    case "staff.upsert": {
      const prev = before.staff[ev.staff.id];
      return prev ? [{ ...meta, type: "staff.upsert", staff: prev }] : [{ ...meta, type: "staff.remove", id: ev.staff.id }];
    }
    case "staff.remove": {
      const prev = before.staff[ev.id];
      return prev ? [{ ...meta, type: "staff.upsert", staff: prev }] : [];
    }
    case "roleSlot.upsert": {
      const prev = before.roleSlots[ev.roleSlot.id];
      return prev
        ? [{ ...meta, type: "roleSlot.upsert", roleSlot: prev }]
        : [{ ...meta, type: "roleSlot.remove", id: ev.roleSlot.id }];
    }
    case "roleSlot.remove": {
      const prev = before.roleSlots[ev.id];
      return prev ? [{ ...meta, type: "roleSlot.upsert", roleSlot: prev }] : [];
    }
    case "template.upsert": {
      const prev = before.templates[ev.template.id];
      return prev
        ? [{ ...meta, type: "template.upsert", template: prev }]
        : [{ ...meta, type: "template.remove", id: ev.template.id }];
    }
    case "template.remove": {
      const prev = before.templates[ev.id];
      return prev ? [{ ...meta, type: "template.upsert", template: prev }] : [];
    }
    case "pattern.upsert": {
      const prev = before.patterns[ev.pattern.id];
      return prev
        ? [{ ...meta, type: "pattern.upsert", pattern: prev }]
        : [{ ...meta, type: "pattern.remove", id: ev.pattern.id }];
    }
    case "pattern.remove": {
      const prev = before.patterns[ev.id];
      return prev ? [{ ...meta, type: "pattern.upsert", pattern: prev }] : [];
    }
    case "roster.upsert": {
      const prev = before.roster[ev.entry.id];
      return prev ? [{ ...meta, type: "roster.upsert", entry: prev }] : [{ ...meta, type: "roster.remove", id: ev.entry.id }];
    }
    case "roster.remove": {
      const prev = before.roster[ev.id];
      return prev ? [{ ...meta, type: "roster.upsert", entry: prev }] : [];
    }
    case "task.add":
      return [{ ...meta, type: "task.remove", id: ev.task.id }];
    case "task.remove": {
      const prev = before.tasks[ev.id];
      if (!prev) return [];
      const out: Event[] = [{ ...meta, type: "task.add", task: prev, residentIds: before.targets[ev.id] ?? [] }];
      for (const a of Object.values(before.assignments)) {
        if (a.taskId === ev.id) out.push({ ...meta, type: "assignment.add", assignment: a });
      }
      return out;
    }
    case "task.done": {
      const prev = before.tasks[ev.id];
      if (!prev) return [];
      return [{ ...meta, type: "task.done", id: ev.id, done: Boolean(prev.done) }];
    }
    case "task.update": {
      const prev = before.tasks[ev.id];
      if (!prev) return [];
      const patch: Record<string, unknown> = {};
      for (const key of Object.keys(ev.patch) as (keyof typeof ev.patch)[]) {
        patch[key] = prev[key];
      }
      return [{ ...meta, type: "task.update", id: ev.id, patch: patch as typeof ev.patch }];
    }
    case "task.setTargets":
      return [{ ...meta, type: "task.setTargets", id: ev.id, residentIds: before.targets[ev.id] ?? [] }];
    case "assignment.add":
      return [{ ...meta, type: "assignment.remove", id: ev.assignment.id, taskId: ev.assignment.taskId, staffId: ev.assignment.staffId }];
    case "assignment.remove": {
      const prev = before.assignments[ev.id];
      return prev ? [{ ...meta, type: "assignment.add", assignment: prev }] : [];
    }
    case "day.setPattern":
      return [{ ...meta, type: "day.setPattern", date: ev.date, patternId: before.days[ev.date]?.appliedPatternId }];
    case "sheet.upsert":
      return [{ ...meta, type: "sheet.upsert", sheet: before.sheets[ev.sheet.residentId] ?? { residentId: ev.sheet.residentId, rows: [] } }];
    default:
      return [];
  }
}

/**
 * まとめて戻す: batch 内のイベントを逆順に打ち消す。
 * history は「イベント」と「適用前の状態」の組。
 */
export function invertBatch(history: { event: Event; before: State }[], batchId: ID): Event[] {
  const out: Event[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (h.event.batchId !== batchId) continue;
    out.push(...invertEvent(h.event, h.before));
  }
  return out;
}
