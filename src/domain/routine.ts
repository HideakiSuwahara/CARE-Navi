/**
 * 施設の日課と、利用者の24時間シート（決定記録 0004）。
 *
 * 時間割への入り方（施設の日課ひとつにつき）:
 * 1. 標準どおりの方 → 一括の枠
 * 2. 時刻を変えた方で、開始が枠の中 → 一括の枠のまま（targetTimes に時刻を残す）
 * 3. 枠の外に変えた方 → 別の枠（同じ時刻の方はまとめる）
 * 4. 「この方はなし」→ 枠に入れない
 * どの方も、一つの日課につき一つの枠にだけ入る。
 */

import type { DateKey, DayPattern, DayPatternItem, ID, Minutes, ResidentSheet, SheetRow, State } from "./types.ts";
import type { Event } from "./events.ts";
import { metaOf, staffForSlots, taskFromPatternItem, type EventContext } from "./pattern.ts";
import { rosterForDate, tasksForDate } from "./checks.ts";
import { clockSortKey } from "./time.ts";

export interface Routine {
  routineId: string;
  templateId: ID;
  name: string;
  groupId?: ID;
  /** 標準の時刻（その日課を含む最初の業務表から） */
  startMin: Minutes;
  endMin: Minutes;
  /** その日課を含む業務表の名前（「平日・入浴日」など。入浴のように曜日が限られる日課の説明に使う） */
  patternNames: string[];
}

/** 施設の日課の一覧（業務表の routineId つきの項目から）。時刻順 */
export function routinesOf(state: State, groupId?: ID): Routine[] {
  const map = new Map<string, Routine>();
  for (const p of Object.values(state.patterns)) {
    for (const it of p.items) {
      if (!it.routineId) continue;
      if (groupId && it.groupId !== groupId) continue;
      const tpl = state.templates[it.templateId];
      const cur = map.get(it.routineId);
      if (cur) {
        if (!cur.patternNames.includes(p.name)) cur.patternNames.push(p.name);
        continue;
      }
      map.set(it.routineId, {
        routineId: it.routineId,
        templateId: it.templateId,
        name: tpl?.name ?? it.routineId,
        groupId: it.groupId,
        startMin: it.startMin,
        endMin: it.endMin,
        patternNames: [p.name],
      });
    }
  }
  return [...map.values()].sort((a, b) => clockSortKey(a.startMin) - clockSortKey(b.startMin) || a.name.localeCompare(b.name, "ja"));
}

/** 一覧の列を絞る時間帯（24時間シートの時計の順＝5:00 起点で区切る） */
export type RoutineBand = "all" | "morning" | "day" | "night";

export const ROUTINE_BANDS: { band: RoutineBand; label: string; range?: string }[] = [
  { band: "all", label: "すべて" },
  { band: "morning", label: "朝", range: "5:00–11:00" },
  { band: "day", label: "昼", range: "11:00–17:00" },
  { band: "night", label: "夜", range: "17:00–翌5:00" },
];

/** 時刻がどの時間帯か。朝=5:00–11:00、昼=11:00–17:00、夜=17:00–翌5:00 */
export function bandOf(startMin: Minutes): Exclude<RoutineBand, "all"> {
  const k = clockSortKey(startMin);
  if (k < 6 * 60) return "morning";
  if (k < 12 * 60) return "day";
  return "night";
}

export function routinesInBand(routines: Routine[], band: RoutineBand): Routine[] {
  return band === "all" ? routines : routines.filter((r) => bandOf(r.startMin) === band);
}

/**
 * その開始時刻が日課の枠の中か（splitRoutineTargets と同じ規則: 標準の開始 ≦ 時刻 ＜ 標準の終わり）。
 * 中なら一括の枠のまま、外なら別の枠になる。
 */
export function isWithinRoutine(routine: Pick<Routine, "startMin" | "endMin">, startMin: Minutes): boolean {
  return startMin >= routine.startMin && startMin < routine.endMin;
}

export function sheetOf(state: State, residentId: ID): ResidentSheet {
  return state.sheets[residentId] ?? { residentId, rows: [] };
}

export function sheetRowFor(state: State, residentId: ID, routineId: string): SheetRow | undefined {
  return state.sheets[residentId]?.rows.find((r) => r.routineId === routineId);
}

/** その方のその日課が、標準と違うか（一覧で目立たせる） */
export function isOverridden(row: SheetRow | undefined): boolean {
  return Boolean(row && (row.skip || row.startMin !== undefined));
}

export interface RoutineSplit {
  /** 一括の枠に入る方 */
  main: ID[];
  /** 一括の枠の中で時刻が違う方の時刻 */
  mainTimes: Record<ID, Minutes>;
  /** 枠の外に変えた方の別の枠（開始時刻ごと） */
  outside: { startMin: Minutes; endMin: Minutes; residentIds: ID[] }[];
  /** 「この方はなし」 */
  skipped: ID[];
}

/** 日課の項目と対象の方を、2. の規則で振り分ける */
export function splitRoutineTargets(state: State, item: DayPatternItem, residentIds: ID[]): RoutineSplit {
  const out: RoutineSplit = { main: [], mainTimes: {}, outside: [], skipped: [] };
  if (!item.routineId) return { ...out, main: [...residentIds] };
  const length = item.endMin - item.startMin;
  const byStart = new Map<Minutes, { endMin: Minutes; residentIds: ID[] }>();
  for (const rid of residentIds) {
    const row = sheetRowFor(state, rid, item.routineId);
    if (row?.skip) {
      out.skipped.push(rid);
      continue;
    }
    if (row?.startMin === undefined) {
      out.main.push(rid);
      continue;
    }
    if (isWithinRoutine(item, row.startMin)) {
      out.main.push(rid);
      if (row.startMin !== item.startMin) out.mainTimes[rid] = row.startMin;
      continue;
    }
    const endMin = row.endMin ?? row.startMin + length;
    const cur = byStart.get(row.startMin) ?? { endMin, residentIds: [] };
    cur.endMin = Math.max(cur.endMin, endMin);
    cur.residentIds.push(rid);
    byStart.set(row.startMin, cur);
  }
  out.outside = [...byStart.entries()].sort((a, b) => a[0] - b[0]).map(([startMin, v]) => ({ startMin, ...v }));
  return out;
}

/** その方だけの行のうち、業務の種類が付いていて、その曜日に入るもの */
export function extraRowsForDate(state: State, weekday: number): { residentId: ID; row: SheetRow }[] {
  const out: { residentId: ID; row: SheetRow }[] = [];
  for (const sheet of Object.values(state.sheets)) {
    if (!state.residents[sheet.residentId]) continue;
    for (const row of sheet.rows) {
      if (row.routineId || !row.templateId || row.startMin === undefined) continue;
      if (row.weekdays && !row.weekdays.includes(weekday)) continue;
      out.push({ residentId: sheet.residentId, row });
    }
  }
  return out;
}

/**
 * その方だけの業務に束ねる番: その方のグループの番で、業務の時刻に勤務が重なるもの。
 * 見つからなければ空（担当未定になる）。
 */
export function slotsForResidentTask(state: State, residentId: ID, startMin: Minutes, endMin: Minutes): ID[] {
  const gid = state.residents[residentId]?.groupId;
  if (!gid) return [];
  return Object.values(state.roleSlots)
    .filter((s) => s.groupId === gid && s.defaultStartMin <= startMin && s.defaultEndMin >= endMin)
    .map((s) => s.id);
}

/** 24時間シートに表示する行（日課の行＋その方だけの行）を時刻順に */
export interface SheetLine {
  key: string;
  /** その時刻（調整後。日課で調整がなければ標準） */
  startMin: Minutes;
  endMin: Minutes;
  name: string;
  routine?: Routine;
  row?: SheetRow;
  /** 標準どおり／時刻を変更／なし／その方だけ */
  kind: "standard" | "changed" | "skipped" | "extra";
}

export function sheetLines(state: State, residentId: ID): SheetLine[] {
  const resident = state.residents[residentId];
  if (!resident) return [];
  const sheet = sheetOf(state, residentId);
  const lines: SheetLine[] = [];
  for (const r of routinesOf(state, resident.groupId)) {
    const row = sheet.rows.find((x) => x.routineId === r.routineId);
    const kind: SheetLine["kind"] = row?.skip ? "skipped" : row?.startMin !== undefined ? "changed" : "standard";
    const startMin = row?.startMin ?? r.startMin;
    lines.push({
      key: r.routineId,
      startMin,
      endMin: row?.endMin ?? startMin + (r.endMin - r.startMin),
      name: r.name,
      routine: r,
      row,
      kind,
    });
  }
  for (const row of sheet.rows) {
    if (row.routineId) continue;
    const startMin = row.startMin ?? 0;
    lines.push({
      key: row.id,
      startMin,
      endMin: row.endMin ?? startMin + 30,
      name: row.templateId ? (state.templates[row.templateId]?.name ?? row.label ?? "") : (row.label ?? ""),
      row,
      kind: "extra",
    });
  }
  // 24時間シートは利用者の一日の時計で、朝（5:00）から並べる
  return lines.sort((a, b) => clockSortKey(a.startMin) - clockSortKey(b.startMin) || a.name.localeCompare(b.name, "ja"));
}

/** シートの1行を差し替えた新しいシート（routineId の行は1つだけ持つ） */
export function withRow(sheet: ResidentSheet, row: SheetRow, ts?: string): ResidentSheet {
  const rows = sheet.rows.filter((r) => r.id !== row.id && !(row.routineId && r.routineId === row.routineId));
  return { ...sheet, rows: [...rows, row], updatedAt: ts ?? sheet.updatedAt };
}

export function withoutRow(sheet: ResidentSheet, rowId: ID, ts?: string): ResidentSheet {
  return { ...sheet, rows: sheet.rows.filter((r) => r.id !== rowId), updatedAt: ts ?? sheet.updatedAt };
}

/** 施設の日課の行を「標準に戻す」（時刻・なしを消し、4項目は残す） */
export function resetRowToStandard(row: SheetRow): SheetRow | null {
  const next: SheetRow = { ...row, startMin: undefined, endMin: undefined, skip: undefined };
  const hasText = next.rhythm || next.preference || next.canDo || next.support;
  return hasText ? next : null;
}

/** 曜日を付けた日付の文字列 */
export function dateLabel(date: DateKey): string {
  const [y, m, d] = date.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${m}/${d}（${"日月火水木金土"[wd]}）`;
}

// ---------------------------------------------------------------------------
// 施設の日課を足す・標準の時刻を変える・やめる（決定記録 0013）
// 日課は業務表の項目なので、そのグループが載っている業務表（平日・入浴日・日曜など）すべてを同じに直す。
// どれも pattern.upsert の 1 バッチ（1 回で元に戻せる）。次に時間割を作るときから入る。
// ---------------------------------------------------------------------------

/** そのグループの項目がある業務表。なければ全部（はじめての日課） */
function patternsOfGroup(state: State, groupId: ID): DayPattern[] {
  const all = Object.values(state.patterns);
  const mine = all.filter((p) => p.items.some((it) => it.groupId === groupId));
  return mine.length > 0 ? mine : all;
}

/**
 * 足した日課を束ねる番: 同じ業務表・同じグループの日課のうち、開始がいちばん近い項目の番。
 * （その時間にその階の日課を受け持っている番。職種で決めつけない）。なければ、その時刻を勤務時間に含む番。
 */
function slotsNear(state: State, pattern: DayPattern, groupId: ID, startMin: Minutes, endMin: Minutes): ID[] {
  const onDuty = (slotId: ID) => {
    const s = state.roleSlots[slotId];
    return Boolean(s && s.defaultStartMin <= startMin && endMin <= s.defaultEndMin);
  };
  const near = pattern.items
    .filter((it) => it.groupId === groupId && it.routineId && it.slotIds.length > 0)
    .sort((a, b) => Math.abs(a.startMin - startMin) - Math.abs(b.startMin - startMin));
  // 近い日課の番のうち、その時刻に勤務している番
  for (const it of near) {
    const slots = it.slotIds.filter(onDuty);
    if (slots.length > 0) return slots;
  }
  // 近い日課がないときは、そのグループの番（グループを持たない番も）から。ほかの階の番には束ねない
  const covering = Object.values(state.roleSlots)
    .filter((s) => !s.groupId || s.groupId === groupId)
    .map((s) => s.id)
    .filter(onDuty);
  if (covering.length > 0) return covering;
  return near[0] ? [...near[0].slotIds] : [];
}

export interface NewRoutine {
  templateId: ID;
  groupId: ID;
  startMin: Minutes;
  endMin: Minutes;
  /** 必要人数（施設が決める予定値）。省くと defaultRoutineHeadcount */
  headcount?: number;
}

/** 日課の必要人数の既定: 同じグループの同じ業務の日課のうち、開始がいちばん近いものの人数。なければ業務の種類の標準 */
export function defaultRoutineHeadcount(state: State, groupId: ID, templateId: ID, startMin: Minutes): number {
  const near = Object.values(state.patterns)
    .flatMap((p) => p.items)
    .filter((it) => it.groupId === groupId && it.templateId === templateId && it.routineId)
    .sort((a, b) => Math.abs(a.startMin - startMin) - Math.abs(b.startMin - startMin))[0];
  return near?.headcount ?? Math.max(1, state.templates[templateId]?.defaultHeadcount ?? 1);
}

/** 日課の今の必要人数（最初の業務表の値） */
export function routineHeadcount(state: State, routineId: string): number | undefined {
  for (const p of Object.values(state.patterns)) {
    const it = p.items.find((x) => x.routineId === routineId);
    if (it) return it.headcount;
  }
  return undefined;
}

/** 日課を足す */
export function addRoutineEvents(state: State, input: NewRoutine, ctx: EventContext): Event[] {
  const tpl = state.templates[input.templateId];
  if (!tpl || input.endMin <= input.startMin) return [];
  const routineId = `rt-${ctx.newId()}`;
  const events: Event[] = [];
  const headcount = Math.max(1, input.headcount ?? defaultRoutineHeadcount(state, input.groupId, input.templateId, input.startMin));
  for (const p of patternsOfGroup(state, input.groupId)) {
    const item: DayPatternItem = {
      id: ctx.newId(),
      templateId: input.templateId,
      startMin: input.startMin,
      endMin: input.endMin,
      groupId: input.groupId,
      targetRule: "allInGroup",
      headcount,
      slotIds: slotsNear(state, p, input.groupId, input.startMin, input.endMin),
      routineId,
    };
    events.push({ ...metaOf(ctx), type: "pattern.upsert", pattern: { ...p, items: [...p.items, item] } });
  }
  return events;
}

/** 日課の標準の時刻（と必要人数）を変える（すべての業務表で） */
export function retimeRoutineEvents(
  state: State,
  routine: Pick<Routine, "routineId" | "groupId">,
  startMin: Minutes,
  endMin: Minutes,
  ctx: EventContext,
  headcount?: number,
): Event[] {
  if (endMin <= startMin) return [];
  const events: Event[] = [];
  const mine = (it: DayPatternItem) => it.routineId === routine.routineId && it.groupId === routine.groupId;
  for (const p of Object.values(state.patterns)) {
    if (!p.items.some(mine)) continue;
    const items = p.items.map((it) =>
      mine(it) ? { ...it, startMin, endMin, ...(headcount ? { headcount: Math.max(1, headcount) } : {}) } : it,
    );
    events.push({ ...metaOf(ctx), type: "pattern.upsert", pattern: { ...p, items } });
  }
  return events;
}

/** 日課をやめる（すべての業務表から外す）。方ごとの時刻・なしの調整も外す（元に戻すと戻る） */
export function removeRoutineEvents(state: State, routine: Pick<Routine, "routineId" | "groupId">, ctx: EventContext): Event[] {
  const events: Event[] = [];
  const { routineId, groupId } = routine;
  const mine = (it: DayPatternItem) => it.routineId === routineId && it.groupId === groupId;
  for (const p of Object.values(state.patterns)) {
    if (!p.items.some(mine)) continue;
    events.push({ ...metaOf(ctx), type: "pattern.upsert", pattern: { ...p, items: p.items.filter((it) => !mine(it)) } });
  }
  // 方ごとの調整は、そのグループの方の分だけ外す
  for (const sheet of Object.values(state.sheets)) {
    if (groupId && state.residents[sheet.residentId]?.groupId !== groupId) continue;
    if (!sheet.rows.some((r) => r.routineId === routineId)) continue;
    events.push({ ...metaOf(ctx), type: "sheet.upsert", sheet: { ...sheet, rows: sheet.rows.filter((r) => r.routineId !== routineId) } });
  }
  return events;
}

/**
 * 足した日課を、もうできている日の時間割にも入れる（グリル U5）。
 * その日の業務表の項目から、グループの全員（なしの方を除く）を対象にした一括の枠を 1 枚作り、
 * 業務表から作るときと同じく、番のその日の出勤者（勤務時間の中）を担当にする。すでにその日課の枠があれば何もしない。
 */
export function addRoutineToDayEvents(state: State, date: DateKey, routineId: string, groupId: ID, ctx: EventContext): Event[] {
  if (tasksForDate(state, date).length === 0) return [];
  if (tasksForDate(state, date, true).some((t) => t.routineId === routineId && t.groupId === groupId)) return [];
  const applied = state.days[date]?.appliedPatternId;
  const patterns = [state.patterns[applied ?? ""], ...Object.values(state.patterns)].filter(Boolean) as DayPattern[];
  const item = patterns.map((p) => p.items.find((it) => it.routineId === routineId && it.groupId === groupId)).find(Boolean);
  if (!item) return [];
  const task = taskFromPatternItem(state, date, item, ctx.newId());
  if (!task) return [];
  const residents = Object.values(state.residents)
    .filter((r) => r.groupId === groupId)
    .sort((a, b) => a.room.localeCompare(b.room, "ja"))
    .map((r) => r.id)
    .filter((rid) => !sheetRowFor(state, rid, routineId)?.skip);
  const events: Event[] = [{ ...metaOf(ctx), type: "task.add", task: { ...task, routineId }, residentIds: residents }];
  const roster = rosterForDate(state, date);
  for (const staffId of staffForSlots(state, date, item.slotIds)) {
    const e = roster.find((r) => r.staffId === staffId);
    if (!e || e.startMin > task.startMin || e.endMin < task.endMin) continue;
    events.push({ ...metaOf(ctx), type: "assignment.add", assignment: { id: ctx.newId(), taskId: task.id, staffId } });
  }
  return events;
}
