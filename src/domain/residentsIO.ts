/**
 * 利用者画面の入出力（純関数）: 名簿の貼り付けの読み取り、24時間シートと一覧の CSV（決定記録 0004 §3・§5）。
 */

import type { Event } from "./events.ts";
import { metaOf, type EventContext } from "./pattern.ts";
import { resetRowToStandard, routinesOf, sheetLines, sheetOf, sheetRowFor, withoutRow, withRow, type Routine, type SheetLine } from "./routine.ts";
import { clockLabel } from "./time.ts";
import type { ID, Minutes, SheetRow, State } from "./types.ts";

export interface PastedResident {
  /** 貼り付けの行番号（1始まり） */
  line: number;
  displayName: string;
  surname: string;
  groupId: ID;
  room: string;
}

export interface PasteResult {
  residents: PastedResident[];
  errors: { line: number; reason: string }[];
}

/** 名簿の貼り付け: 1行1人「名前, グループ, 部屋」。区切りはカンマ・タブ・全角カンマ。姓は名前の空白の前 */
export function parseResidentPaste(state: State, text: string): PasteResult {
  const groups = Object.values(state.groups);
  const out: PasteResult = { residents: [], errors: [] };
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    if (!raw.trim()) return;
    const cells = raw.split(/[,\t，、]/).map((c) => c.trim());
    const [name = "", groupName = "", room = ""] = cells;
    if (!name) {
      out.errors.push({ line, reason: "名前がありません" });
      return;
    }
    if (!groupName) {
      out.errors.push({ line, reason: "グループがありません（名前, グループ, 部屋 の順）" });
      return;
    }
    const group = groups.find((g) => g.name === groupName);
    if (!group) {
      out.errors.push({ line, reason: `グループ「${groupName}」が見つかりません（${groups.map((g) => g.name).join("・")}）` });
      return;
    }
    const displayName = name.replace(/[\s　]+/g, " ");
    const surname = displayName.split(" ")[0];
    const dup = Object.values(state.residents).some((r) => r.displayName === displayName && r.groupId === group.id);
    if (dup || out.residents.some((r) => r.displayName === displayName && r.groupId === group.id)) {
      out.errors.push({ line, reason: `${displayName}様はすでに登録されています` });
      return;
    }
    out.residents.push({ line, displayName, surname, groupId: group.id, room });
  });
  return out;
}

function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** 行の配列を CSV（UTF-8 BOM つき、CRLF）にする。Excel で開ける */
export function toCsv(rows: string[][]): string {
  return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function lineStatus(line: SheetLine): string {
  switch (line.kind) {
    case "standard":
      return "標準";
    case "changed":
      return "変更";
    case "skipped":
      return "この方はなし";
    case "extra":
      return "この方だけ";
  }
}

/** 24時間シート1枚の CSV の行 */
export function sheetCsvRows(state: State, residentId: ID): string[][] {
  const r = state.residents[residentId];
  if (!r) return [];
  const group = state.groups[r.groupId]?.name ?? "";
  const rows: string[][] = [
    ["利用者", `${r.displayName}様`, "部屋", r.room, "グループ", group],
    ["時刻", "業務・日課", "状態", "生活リズム", "意向・好み", "自分でできること", "サポートが必要なこと"],
  ];
  for (const l of sheetLines(state, residentId)) {
    rows.push([
      l.kind === "skipped" ? "" : clockLabel(l.startMin),
      l.name,
      lineStatus(l),
      l.row?.rhythm ?? "",
      l.row?.preference ?? "",
      l.row?.canDo ?? "",
      l.row?.support ?? "",
    ]);
  }
  return rows;
}

/** 一覧の CSV の行: 利用者×日課の時刻。標準どおりは空欄、なしは「なし」 */
export function routineGridCsvRows(state: State, groupId: ID): string[][] {
  const routines = routinesOf(state, groupId);
  const header = ["部屋", "名前", ...routines.map((x) => `${x.name}（標準 ${clockLabel(x.startMin)}）`)];
  const rows: string[][] = [header];
  for (const r of residentsOfGroup(state, groupId)) {
    rows.push([
      r.room,
      r.displayName,
      ...routines.map((x) => {
        const row = sheetRowFor(state, r.id, x.routineId);
        if (row?.skip) return "なし";
        return row?.startMin !== undefined ? clockLabel(row.startMin) : "";
      }),
    ]);
  }
  return rows;
}

/** グループの利用者を部屋番号順に */
export function residentsOfGroup(state: State, groupId: ID) {
  return Object.values(state.residents)
    .filter((r) => r.groupId === groupId)
    .sort((a, b) => a.room.localeCompare(b.room, "ja", { numeric: true }) || a.displayName.localeCompare(b.displayName, "ja"));
}

// ---------------------------------------------------------------------------
// シートを直すイベント（1回の操作＝1つの batchId。画面は dispatch するだけ）
// ---------------------------------------------------------------------------

export type RoutineChange = { kind: "time"; startMin: Minutes } | { kind: "skip" } | { kind: "reset" };

/** 日課のマスを直す（一人でも、まとめてでも）。標準の時刻を入れたら「標準に戻す」と同じ */
export function routineChangeEvents(state: State, ctx: EventContext, residentIds: ID[], routine: Routine, change: RoutineChange): Event[] {
  const events: Event[] = [];
  const c: RoutineChange = change.kind === "time" && change.startMin === routine.startMin ? { kind: "reset" } : change;
  for (const rid of residentIds) {
    if (!state.residents[rid]) continue;
    const sheet = sheetOf(state, rid);
    const cur = sheetRowFor(state, rid, routine.routineId);
    let next;
    if (c.kind === "reset") {
      if (!cur) continue;
      const row = resetRowToStandard(cur);
      next = row ? withRow(sheet, row, ctx.ts) : withoutRow(sheet, cur.id, ctx.ts);
    } else {
      const base: SheetRow = cur ?? { id: ctx.newId(), routineId: routine.routineId };
      const row: SheetRow =
        c.kind === "skip" ? { ...base, skip: true, startMin: undefined, endMin: undefined } : { ...base, skip: undefined, startMin: c.startMin, endMin: undefined };
      next = withRow(sheet, row, ctx.ts);
    }
    events.push({ ...metaOf(ctx), type: "sheet.upsert", sheet: next });
  }
  return events;
}

export type SheetTextField = "rhythm" | "preference" | "canDo" | "support";

export const SHEET_TEXT_FIELDS: { field: SheetTextField; label: string }[] = [
  { field: "rhythm", label: "生活リズム" },
  { field: "preference", label: "意向・好み" },
  { field: "canDo", label: "自分でできること" },
  { field: "support", label: "サポートが必要なこと" },
];

/** 24時間シートの1行の文章を保存する。変わっていなければ null */
export function sheetTextEvent(state: State, ctx: EventContext, residentId: ID, line: SheetLine, field: SheetTextField, value: string): Event | null {
  const text = value.trim();
  const rows = sheetOf(state, residentId).rows;
  const cur = line.row ? rows.find((r) => r.id === line.row!.id) : line.routine ? rows.find((r) => r.routineId === line.routine!.routineId) : undefined;
  if ((cur?.[field] ?? "") === text) return null;
  const base: SheetRow = cur ?? { id: ctx.newId(), routineId: line.routine?.routineId };
  const row: SheetRow = { ...base, [field]: text || undefined };
  const sheet = sheetOf(state, residentId);
  const empty = row.routineId && !row.skip && row.startMin === undefined && !row.rhythm && !row.preference && !row.canDo && !row.support;
  const next = empty ? withoutRow(sheet, row.id, ctx.ts) : withRow(sheet, row, ctx.ts);
  return { ...metaOf(ctx), type: "sheet.upsert", sheet: next };
}

/** その方だけの行を足す。業務の種類（templateId）を付けると、次に時間割を作るときに枠ができる */
export function extraRowEvent(state: State, ctx: EventContext, residentId: ID, input: { startMin: Minutes; label: string; templateId?: ID }): Event {
  const tpl = input.templateId ? state.templates[input.templateId] : undefined;
  const row: SheetRow = {
    id: ctx.newId(),
    startMin: input.startMin,
    endMin: tpl ? input.startMin + tpl.defaultDurationMin : undefined,
    label: input.label.trim() || tpl?.name || "",
    ...(tpl ? { templateId: tpl.id } : {}),
  };
  return { ...metaOf(ctx), type: "sheet.upsert", sheet: withRow(sheetOf(state, residentId), row, ctx.ts) };
}

export function removeRowEvent(state: State, ctx: EventContext, residentId: ID, rowId: ID): Event {
  return { ...metaOf(ctx), type: "sheet.upsert", sheet: withoutRow(sheetOf(state, residentId), rowId, ctx.ts) };
}
