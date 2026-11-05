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

  // この業務表で作った担当の時間（別の枠に付ける1人を選ぶとき、重なりを避けるため）
  const busy = new Map<ID, { startMin: number; endMin: number }[]>();
  const assign = (taskId: ID, staffId: ID, startMin: number, endMin: number) => {
    events.push({ ...metaOf(ctx), type: "assignment.add", assignment: { id: ctx.newId(), taskId, staffId } });
    busy.set(staffId, [...(busy.get(staffId) ?? []), { startMin, endMin }]);
  };
  const addTask = (task: TaskInstance, residentIds: ID[], slotIds: ID[]) => {
    events.push({ ...metaOf(ctx), type: "task.add", task, residentIds });
    for (const staffId of staffForSlots(state, date, slotIds)) assign(task.id, staffId, task.startMin, task.endMin);
  };
  /**
   * 日課から分かれた枠・その方だけの枠: 番の出勤者のうち、その時刻に勤務していて、ほかの担当と重ならない人を
   * 必要人数だけ付ける（番の全員は付けない。決定記録 0004 / 現場レビュー）。いなければ担当未定。
   */
  const addTaskPickOne = (task: TaskInstance, residentIds: ID[], slotIds: ID[]) => {
    events.push({ ...metaOf(ctx), type: "task.add", task, residentIds });
    let need = Math.max(1, task.headcount);
    for (const staffId of staffForSlots(state, date, slotIds)) {
      if (need === 0) break;
      const entry = rosterForDate(state, date).find((r) => r.staffId === staffId);
      if (!entry || entry.startMin > task.startMin || entry.endMin < task.endMin) continue;
      const clash = (busy.get(staffId) ?? []).some((b) => b.startMin < task.endMin && task.startMin < b.endMin);
      if (clash) continue;
      assign(task.id, staffId, task.startMin, task.endMin);
      need--;
    }
  };

  const later: (() => void)[] = [];
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
      later.push(() => addTaskPickOne(
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
      ));
    }
  }
  // 分かれた枠は、ふだんの枠の担当がすべて決まってから、空いている人を選ぶ
  for (const run of later) run();

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
    if (task) addTaskPickOne({ ...task, targetMode: "individual" }, [residentId], slotIds);
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
  /** entries の出どころ（recent = 先週の同じ曜日がなく、いちばん近い前の日から） */
  source: "today" | "lastWeek" | "recent" | "none";
  /** lastWeek / recent のとき、写した日 */
  fromDate?: DateKey;
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
  if (prev.length === 0) {
    const recent = recentDraft(state, date, newId);
    if (recent) return { date, patternId, ...recent };
    // はじめての日: 職員を全員「休み」で並べる。番は職種の言葉がある番（看護・介護助手・スポット）だけ仮に入れ、ほかは人が選ぶ
    const entries = Object.values(state.staff)
      .sort((a, b) => a.displayName.localeCompare(b.displayName, "ja"))
      .map((staff) => {
        const slot = suggestSlot(state, staff.role);
        return {
          id: newId(),
          date,
          staffId: staff.id,
          slotId: slot?.id,
          startMin: slot?.defaultStartMin ?? 9 * 60,
          endMin: slot?.defaultEndMin ?? 18 * 60,
          firstTimer: isFirstTimeDefault(state, staff.id, date),
          absent: true,
        };
      });
    return { date, patternId, entries, source: "none" };
  }
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
  return { date, patternId, entries, source: "lastWeek", fromDate: lastWeek };
}

/**
 * 先週の同じ曜日がないとき（使い始めの1週間）: 6日前までのいちばん近い日の番を写す（決定記録 0012）。
 * - その日に出勤した人は同じ番で出勤（番の既定の勤務時間）。その日に休みだった人は休みのまま並べる。
 * - 前の日に夜勤（翌日にかかる勤務）だった人は、今日は明けなので休みで並べる。
 * - スポット・初回の人は写さない。その日の名簿にいない職員は休みで足す（貼り付けで足した人も並ぶ）。
 */
function recentDraft(state: State, date: DateKey, newId: () => ID): Pick<MorningDraft, "entries" | "source" | "fromDate"> | null {
  for (let back = 1; back <= 6; back++) {
    const from = addDays(date, -back);
    const prev = rosterForDate(state, from);
    if (prev.length === 0) continue;
    const entries: RosterEntry[] = [];
    const listed = new Set<ID>();
    for (const e of prev) {
      const staff = state.staff[e.staffId];
      if (!staff || staff.role === "スポット" || e.firstTimer || listed.has(e.staffId)) continue;
      listed.add(e.staffId);
      const slot = e.slotId ? state.roleSlots[e.slotId] : undefined;
      const afterNight = back === 1 && !e.absent && e.endMin > 24 * 60;
      entries.push({
        id: newId(),
        date,
        staffId: e.staffId,
        slotId: e.slotId,
        startMin: slot?.defaultStartMin ?? e.startMin,
        endMin: slot?.defaultEndMin ?? e.endMin,
        firstTimer: false,
        absent: e.absent || afterNight,
        carriedFrom: from,
      });
    }
    for (const staff of Object.values(state.staff)) {
      if (listed.has(staff.id) || staff.role === "スポット") continue;
      const slot = suggestSlot(state, staff.role);
      entries.push({
        id: newId(),
        date,
        staffId: staff.id,
        slotId: slot?.id,
        startMin: slot?.defaultStartMin ?? 9 * 60,
        endMin: slot?.defaultEndMin ?? 18 * 60,
        firstTimer: false,
        absent: true,
      });
    }
    // 出勤の人を先に、番の並び順で
    const order = (e: RosterEntry) => (e.absent ? 1000 : 0) + (e.slotId ? (state.roleSlots[e.slotId]?.sortOrder ?? 999) : 999);
    entries.sort((a, b) => order(a) - order(b));
    return { entries, source: "recent", fromDate: from };
  }
  return null;
}

/**
 * 番の既定値（仮）。職種の言葉を含む番（介護助手・看護・スポット）があればそれ、
 * なければ、まだ誰にも当てていない番を並び順で。人が選び直す前提の既定値で、可否は担当条件で決まる。
 */
export function suggestSlot(state: State, role: string, used: Set<ID> = new Set()) {
  const slots = Object.values(state.roleSlots).sort((a, b) => a.sortOrder - b.sortOrder);
  const special = ["介護助手", "看護", "スポット"];
  const key = special.find((k) => role.includes(k));
  // 職種の言葉がある番だけ仮に入れる。介護職員は番を空にして、人が選ぶ（勝手に夜勤や遅番に入れない）
  if (!key) return undefined;
  return slots.find((x) => x.name.includes(key) && !used.has(x.id)) ?? slots.find((x) => x.name.includes(key));
}

/** 初回の印の既定: 職種がスポットで、これまでに出勤（休み以外）が一度もない人 */
export function isFirstTimeDefault(state: State, staffId: ID, date: DateKey): boolean {
  const staff = state.staff[staffId];
  if (!staff || staff.role !== "スポット") return false;
  return !Object.values(state.roster).some((e) => e.staffId === staffId && e.date < date && !e.absent);
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
