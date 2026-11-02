/**
 * 一日の型（役割表）→ 当日の業務予定と担当。
 * 「朝は人に役割を付けるだけ」: 役割枠に束ねた業務へ、当日その役割の出勤者が担当として入る。
 */

import type { Event } from "./events.ts";
import { rosterForDate, tasksForDate } from "./checks.ts";
import { reduce as reduceOne } from "./reducer.ts";
import { extraRowsForDate, slotsForResidentTask, splitRoutineTargets } from "./routine.ts";
import type { DateKey, DayPattern, DayPatternItem, ID, RosterEntry, State, TaskInstance } from "./types.ts";

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

  const addTask = (task: TaskInstance, residentIds: ID[], slotIds: ID[]) => {
    events.push({ ...metaOf(ctx), type: "task.add", task, residentIds });
    for (const staffId of staffForSlots(state, date, slotIds)) {
      events.push({ ...metaOf(ctx), type: "assignment.add", assignment: { id: ctx.newId(), taskId: task.id, staffId } });
    }
  };

  for (const item of pattern.items) {
    const base = taskFromPatternItem(state, date, item, ctx.newId());
    if (!base) continue;
    const targets = residentsForItem(state, item);
    if (!item.routineId) {
      addTask(base, targets, item.slotIds);
      continue;
    }
    // 施設の日課: 24時間シートの調整で振り分ける（決定記録 0004 §2）
    const split = splitRoutineTargets(state, item, targets);
    if (split.main.length > 0 || targets.length === 0) {
      const mainTimes = Object.keys(split.mainTimes).length > 0 ? split.mainTimes : undefined;
      addTask({ ...base, routineId: item.routineId, targetTimes: mainTimes }, split.main, item.slotIds);
    }
    const tpl = state.templates[item.templateId];
    for (const o of split.outside) {
      addTask(
        {
          ...base,
          id: ctx.newId(),
          routineId: item.routineId,
          targetMode: o.residentIds.length === 1 ? "individual" : "group",
          startMin: o.startMin,
          endMin: o.endMin,
          headcount: Math.max(1, tpl?.defaultHeadcount ?? 1),
          targetTimes: undefined,
        },
        o.residentIds,
        item.slotIds,
      );
    }
  }

  // 24時間シートの「その方だけの行」（業務の種類つき）から、その方の個別の枠
  for (const { residentId, row } of extraRowsForDate(state, weekdayOf(date))) {
    const tpl = state.templates[row.templateId!];
    if (!tpl) continue;
    const startMin = row.startMin!;
    const endMin = row.endMin ?? startMin + tpl.defaultDurationMin;
    const resident = state.residents[residentId];
    const slotIds = slotsForResidentTask(state, residentId, startMin, endMin);
    const task = taskFromPatternItem(
      state,
      date,
      { id: row.id, templateId: tpl.id, startMin, endMin, groupId: resident?.groupId, targetRule: "residents", residentIds: [residentId], headcount: Math.max(1, tpl.defaultHeadcount), slotIds },
      ctx.newId(),
    );
    if (task) addTask({ ...task, targetMode: "individual" }, [residentId], slotIds);
  }

  events.push({ ...metaOf(ctx), type: "day.setPattern", date, patternId });
  return events;
}

/**
 * 今日の形を型として保存する。人（担当）は保存せず、業務・時刻・対象の決め方・必要人数・役割枠だけを残す。
 */
export function patternFromDay(state: State, date: DateKey, name: string, ctx: EventContext): DayPattern | null {
  const items: DayPatternItem[] = [];
  // 日課から分かれた枠（時刻を変えた方の別の枠）は業務表に残さない。日課ごとに対象の多い枠を1つだけ残す
  const mainOfRoutine = new Map<string, ID>();
  for (const t of tasksForDate(state, date)) {
    if (!t.routineId) continue;
    const cur = mainOfRoutine.get(t.routineId);
    if (!cur || (state.targets[t.id]?.length ?? 0) > (state.targets[cur]?.length ?? 0)) mainOfRoutine.set(t.routineId, t.id);
  }
  for (const t of tasksForDate(state, date)) {
    if (!t.templateId) continue;
    if (t.routineId && mainOfRoutine.get(t.routineId) !== t.id) continue;
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
      routineId: t.routineId,
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

// ---------------------------------------------------------------------------
// 朝: 「今日の時間割を作る」（決定記録 0003 §2）
// 開いた時点で、先週の同じ曜日の番と、曜日の業務表を入れておく。人は違うところだけ直して1タップ。
// ---------------------------------------------------------------------------

/** "2026-11-03" → 曜日（0=日〜6=土）。タイムゾーンに依存しないよう UTC で計算する */
export function weekdayOf(date: DateKey): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(date: DateKey, days: number): DateKey {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

/** その日の既定の業務表: 曜日が合う業務表 → 先週の同じ曜日に使った業務表 → 最初の業務表 */
export function patternForDate(state: State, date: DateKey): ID | undefined {
  const wd = weekdayOf(date);
  const patterns = Object.values(state.patterns);
  const byWeekday = patterns.find((p) => p.weekdays?.includes(wd));
  if (byWeekday) return byWeekday.id;
  const lastWeek = state.days[addDays(date, -7)]?.appliedPatternId;
  if (lastWeek && state.patterns[lastWeek]) return lastWeek;
  return patterns[0]?.id;
}

export interface MorningDraft {
  date: DateKey;
  patternId?: ID;
  /** 今日の出勤者の下書き。すでに今日の出勤者があればそれ、なければ先週の同じ曜日から */
  entries: RosterEntry[];
  /** entries の出どころ */
  source: "today" | "lastWeek" | "none";
}

/**
 * 朝の下書き。先週の同じ曜日の出勤者を、今日の日付・初回なし・休みなしで写す。
 * - 写した行には carriedFrom（先週の日付）を付ける。画面で「先週 10/27 から」と出し、休みの人を外してもらう。
 * - スポット・応援（職種が「スポット」、または先週が初回だった人）は写さない。毎回入る人ではないため。
 * - 番（役割枠）の既定の勤務時間があればそれに合わせる。
 */
export function morningDraft(state: State, date: DateKey, newId: () => ID): MorningDraft {
  const today = rosterForDate(state, date);
  const patternId = patternForDate(state, date);
  if (today.length > 0) return { date, patternId, entries: today.map((e) => ({ ...e })), source: "today" };
  const lastWeek = addDays(date, -7);
  const prev = rosterForDate(state, lastWeek);
  if (prev.length === 0) return { date, patternId, entries: [], source: "none" };
  const entries = prev
    .filter((e) => {
      const staff = state.staff[e.staffId];
      return staff && staff.role !== "スポット" && !e.firstTimer;
    })
    .map((e) => {
      const slot = e.slotId ? state.roleSlots[e.slotId] : undefined;
      return {
        id: newId(),
        date,
        staffId: e.staffId,
        slotId: e.slotId,
        startMin: slot?.defaultStartMin ?? e.startMin,
        endMin: slot?.defaultEndMin ?? e.endMin,
        firstTimer: false,
        absent: false,
        carriedFrom: lastWeek,
      };
    });
  return { date, patternId, entries, source: "lastWeek" };
}

/**
 * 「この内容で作る」: 出勤者の登録と業務表の適用を1つのバッチにする（1回で元に戻せる）。
 */
export function createDayEvents(state: State, draft: MorningDraft, ctx: EventContext): Event[] {
  const events: Event[] = [];
  const keep = new Set(draft.entries.map((e) => e.id));
  for (const e of rosterForDate(state, draft.date)) {
    if (!keep.has(e.id)) events.push({ ...metaOf(ctx), type: "roster.remove", id: e.id });
  }
  for (const entry of draft.entries) events.push({ ...metaOf(ctx), type: "roster.upsert", entry });
  if (!draft.patternId) return events;
  let s = state;
  for (const ev of events) s = reduceOne(s, ev);
  return [...events, ...applyPatternEvents(s, draft.date, draft.patternId, ctx)];
}
