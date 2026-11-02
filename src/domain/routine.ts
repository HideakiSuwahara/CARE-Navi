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

import type { DateKey, DayPatternItem, ID, Minutes, ResidentSheet, SheetRow, State } from "./types.ts";
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
    if (row.startMin >= item.startMin && row.startMin < item.endMin) {
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
