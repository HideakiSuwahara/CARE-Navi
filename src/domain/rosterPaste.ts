/**
 * 勤務表の貼り付け（月）。決定記録 0015、グリル 2026-11-05。
 * Excel の表（1 行目が日付、1 列目が名前、セルが番の略称）を貼る → 日付ごとの出勤者と番（roster.upsert）。
 * - 番の略称は、番の名前と照らす（「早番A」に「早A」「早番A」「早番Ａ」）。照らせない略称は、画面で 1 回だけ選ばせる（aliases）。
 * - 「休」「公」「公休」「明」「有」「年休」「/」「－」「-」「×」と空欄は休み。
 * - 同じ日を貼り直すと、その日のその職員の行は置き換える（表にいない職員の行は触らない）。
 * - 画像・PDF の読み取りは作らない（0002）。
 */

import type { Event } from "./events.ts";
import { metaOf, type EventContext } from "./pattern.ts";
import type { DateKey, ID, RoleSlot, RosterEntry, State } from "./types.ts";

export type CellMapping = ID | "off";

export interface RosterPasteOptions {
  /** 1 行目が「1, 2, 3…」のときの年と月（1〜12） */
  year: number;
  month: number;
  /** 照らせなかった略称に、画面で選んだ番（または休み） */
  aliases?: Record<string, CellMapping>;
}

export interface RosterPasteResult {
  /** 読めた日付（表の列の順） */
  dates: DateKey[];
  /** 名簿と照らせた職員（表の行の順） */
  staffIds: ID[];
  /** 日付ごとの出勤者と番（休みは slotId なし） */
  cells: { date: DateKey; staffId: ID; slotId?: ID }[];
  /** 名簿にいない名前（行番号つき） */
  unmatchedNames: { line: number; name: string }[];
  /** 照らせなかった略称（画面で選ばせる） */
  unknownCells: string[];
  /** 読めなかった理由（1 行目が日付でない など） */
  errors: string[];
}

const OFF_WORDS = new Set(["休", "公", "公休", "明", "明け", "有", "有休", "年休", "希", "/", "／", "－", "-", "ー", "×", "✕", "−"]);

const z2h = (s: string) =>
  s
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s　]+/g, " ")
    .trim();

const splitCells = (line: string): string[] => (line.includes("\t") ? line.split("\t") : line.split(/[,，]/)).map((c) => z2h(c));

/** 1 行目のセルを日付に。「1」「11/1」「11月1日」「2026-11-01」「1(土)」を読む */
export function parseDateCell(cell: string, year: number, month: number): DateKey | null {
  const c = z2h(cell).replace(/\(.*?\)|（.*?）|[日]$/g, "").trim();
  let m: RegExpMatchArray | null;
  if ((m = c.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})$/))) return key(Number(m[1]), Number(m[2]), Number(m[3]));
  if ((m = c.match(/^(\d{1,2})[/月.](\d{1,2})$/))) return key(year, Number(m[1]), Number(m[2]));
  if ((m = c.match(/^(\d{1,2})$/))) return key(year, month, Number(m[1]));
  return null;
}

function key(y: number, m: number, d: number): DateKey | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * 番の名前の照らし方: 全角半角と「番」の有無をそろえて同じなら一致。
 * 違えば、略称の文字が番の名前にその順で含まれる（「日B」→「日勤B」、「早A」→「早番A」）番が 1 つだけならそれ。2 つ以上なら決めない（「早」は早番A・B で決まらない）
 */
export function matchSlot(cell: string, slots: RoleSlot[]): RoleSlot | null {
  const norm = (s: string) => z2h(s).replace(/番/g, "").replace(/\s/g, "");
  const c = norm(cell);
  if (!c) return null;
  const exact = slots.filter((s) => norm(s.name) === c);
  if (exact.length === 1) return exact[0];
  const inOrder = (needle: string, hay: string) => {
    let i = 0;
    for (const ch of hay) if (ch === needle[i]) i++;
    return i === needle.length;
  };
  const loose = slots.filter((s) => inOrder(c, norm(s.name)));
  if (loose.length === 1) return loose[0];
  return null;
}

export function isOffCell(cell: string): boolean {
  const c = z2h(cell);
  return c === "" || OFF_WORDS.has(c);
}

/** 名前の照らし方: 空白を除いた表示名、または姓が一致（姓が同じ人が 2 人いれば表示名だけ） */
function matchStaff(state: State, name: string): ID | null {
  const n = z2h(name).replace(/\s/g, "");
  if (!n) return null;
  const all = Object.values(state.staff);
  const full = all.filter((s) => s.displayName.replace(/[\s　]/g, "") === n);
  if (full.length === 1) return full[0].id;
  const sur = all.filter((s) => s.surname === n);
  if (sur.length === 1) return sur[0].id;
  return null;
}

export function parseRosterPaste(state: State, text: string, opts: RosterPasteOptions): RosterPasteResult {
  const out: RosterPasteResult = { dates: [], staffIds: [], cells: [], unmatchedNames: [], unknownCells: [], errors: [] };
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) {
    if (text.trim()) out.errors.push("2 行以上（1 行目が日付、2 行目から職員）を貼ってください");
    return out;
  }
  const header = splitCells(lines[0]);
  // 1 列目は名前の見出しなので飛ばす。日付に読めない列は null（その列は読まない）
  const cols: (DateKey | null)[] = header.map((h, i) => (i === 0 ? null : parseDateCell(h, opts.year, opts.month)));
  const dates = cols.filter((d): d is DateKey => Boolean(d));
  if (dates.length === 0) {
    out.errors.push("1 行目に日付が見つかりません（1, 2, 3… か 11/1 の形で）");
    return out;
  }
  out.dates = dates;
  const slots = Object.values(state.roleSlots);
  const aliases = opts.aliases ?? {};
  const unknown = new Set<string>();
  lines.slice(1).forEach((line, idx) => {
    const cells = splitCells(line);
    const name = cells[0] ?? "";
    if (!name) return;
    const staffId = matchStaff(state, name);
    if (!staffId) {
      out.unmatchedNames.push({ line: idx + 2, name });
      return;
    }
    out.staffIds.push(staffId);
    cols.forEach((date, ci) => {
      if (!date || ci === 0) return;
      const raw = cells[ci] ?? "";
      const c = z2h(raw);
      if (isOffCell(c)) {
        out.cells.push({ date, staffId });
        return;
      }
      const alias = aliases[c];
      if (alias === "off") {
        out.cells.push({ date, staffId });
        return;
      }
      const slot = alias ? state.roleSlots[alias] : matchSlot(c, slots);
      if (slot) out.cells.push({ date, staffId, slotId: slot.id });
      else unknown.add(c);
    });
  });
  out.unknownCells = [...unknown];
  return out;
}

/**
 * 貼り付けた勤務表をイベントにする。表にある日付 × 職員の既存の行は外して入れ直す（置き換え）。
 * 照らせない略称が残っているときは何も作らない（画面で選んでから）。
 */
export function rosterPasteEvents(state: State, parsed: RosterPasteResult, ctx: EventContext): Event[] {
  if (parsed.errors.length > 0 || parsed.unknownCells.length > 0 || parsed.cells.length === 0) return [];
  const events: Event[] = [];
  const dates = new Set(parsed.dates);
  const staff = new Set(parsed.staffIds);
  for (const e of Object.values(state.roster)) {
    if (dates.has(e.date) && staff.has(e.staffId)) events.push({ ...metaOf(ctx), type: "roster.remove", id: e.id });
  }
  for (const c of parsed.cells) {
    const slot = c.slotId ? state.roleSlots[c.slotId] : undefined;
    const st = state.staff[c.staffId];
    const entry: RosterEntry = {
      id: ctx.newId(),
      date: c.date,
      staffId: c.staffId,
      ...(slot ? { slotId: slot.id } : {}),
      startMin: slot?.defaultStartMin ?? 9 * 60,
      endMin: slot?.defaultEndMin ?? 18 * 60,
      firstTimer: Boolean(slot) && st?.role === "スポット",
      absent: !slot,
    };
    events.push({ ...metaOf(ctx), type: "roster.upsert", entry });
  }
  return events;
}

/** トーストの文 */
export function rosterPasteLabel(parsed: RosterPasteResult): string {
  const first = parsed.dates[0];
  const last = parsed.dates[parsed.dates.length - 1];
  const fmt = (d: DateKey) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  return `勤務表を入れました（${fmt(first)}〜${fmt(last)}・${parsed.staffIds.length}人）`;
}
