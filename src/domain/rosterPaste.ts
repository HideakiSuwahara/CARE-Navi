/**
 * 勤務表の貼り付け（月）。決定記録 0015、グリル 2026-11-05。
 * Excel の表（日付の行、名前の列、マスが番の略称）を貼る → 日付ごとの出勤者と番（roster.upsert）。
 * - 番の略称は、番の名前と照らす（「早番A」に「早A」「早番A」「早番Ａ」）。1 文字・英数字だけの略称（C・D・東）は黙って当てずに選ばせる。
 * - 「休」「公休」「明」「有休」「年」「特」「代」「振」「欠」「病」「/」「－」「×」と空欄は休み。
 * - 日が前の列より小さくなったら翌月（締め日またぎの 21 日〜20 日の表）。
 * - 名簿と照らせた職員のマスが全部空欄の日は入れない（未記入の列で全員休みにしない）。今日より前の日も変えない。
 * - 同じ日を貼り直すと、その日のその職員の行は置き換える（表にいない職員の行は変えない）。
 * - 画像・PDF の読み取りは作らない（0002）。
 */

import type { Event } from "./events.ts";
import { metaOf, type EventContext } from "./pattern.ts";
import type { DateKey, ID, RoleSlot, RosterEntry, State } from "./types.ts";

export type CellMapping = ID | "off";

export interface RosterPasteOptions {
  /** 表の最初の日の年と月（1〜12）。日付の行が「1, 2, 3…」のときに使う */
  year: number;
  month: number;
  /** 照らせなかった略称に、画面で選んだ番（または休み） */
  aliases?: Record<string, CellMapping>;
  /** この日より前の日は変えない（既定: 変えない日なし） */
  today?: DateKey;
}

export interface RosterPasteResult {
  /** 入れる日付（表の列の順。空欄だけの日と今日より前の日を除く） */
  dates: DateKey[];
  /** 名簿と照らせた職員（表の行の順） */
  staffIds: ID[];
  /** 日付ごとの出勤者と番（休みは slotId なし） */
  cells: { date: DateKey; staffId: ID; slotId?: ID; firstTimer: boolean }[];
  /** 名簿と照らせなかった名前（行番号つき） */
  unmatchedNames: { line: number; name: string }[];
  /** 照らせなかった略称（画面で選ばせる） */
  unknownCells: string[];
  /** 読めた略称と番の対応（確かめ用） */
  readMappings: { cell: string; slotName: string }[];
  /** 休みとして読んだ印（空欄は「空欄」） */
  offCellsSeen: string[];
  /** 名簿と照らせた職員のマスが全部空欄だったので入れない日 */
  skippedEmptyDates: DateKey[];
  /** 今日より前なので変えない日 */
  skippedPastDates: DateKey[];
  /** 読めなかった理由（日付の行が無い など） */
  errors: string[];
}

const OFF_WORDS = new Set([
  "休",
  "公",
  "公休",
  "休日",
  "明",
  "明け",
  "有",
  "有休",
  "年",
  "年休",
  "特",
  "特休",
  "代",
  "代休",
  "振",
  "振休",
  "欠",
  "病",
  "育",
  "産",
  "慶",
  "希",
  "/",
  "／",
  "－",
  "-",
  "ー",
  "×",
  "✕",
  "−",
]);

const z2h = (s: string) =>
  s
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s　]+/g, " ")
    .trim();

const splitCells = (line: string): string[] => (line.includes("\t") ? line.split("\t") : line.split(/[,，]/)).map((c) => z2h(c));

/** 日付のマスを読む。「1」「1 土」「1(土)」「11/1」「11月1日」「2026-11-01」 */
export function parseDateCell(cell: string, year: number, month: number): DateKey | null {
  const c = z2h(cell)
    .replace(/\(.*?\)|（.*?）/g, "")
    .replace(/\s*[月火水木金土日祝]$/, "")
    .replace(/日$/, "")
    .trim();
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

/** 日付の行を読む。日が前の列より小さくなったら翌月（12 月の次は翌年 1 月） */
export function parseDateRow(cells: string[], year: number, month: number): (DateKey | null)[] {
  let y = year;
  let mo = month;
  let prevDay = 0;
  return cells.map((h) => {
    const c = z2h(h)
      .replace(/\(.*?\)|（.*?）/g, "")
      .replace(/\s*[月火水木金土日祝]$/, "")
      .replace(/日$/, "")
      .trim();
    if (/^\d{1,2}$/.test(c)) {
      const d = Number(c);
      if (d < prevDay) {
        mo++;
        if (mo > 12) {
          mo = 1;
          y++;
        }
      }
      const k = key(y, mo, d);
      if (k) prevDay = d;
      return k;
    }
    return parseDateCell(h, year, month);
  });
}

/**
 * 番の名前の照らし方: 全角半角と「番」の有無をそろえて同じなら一致。
 * 違えば、略称の文字が番の名前にその順で含まれる番（「日B」→「日勤B」、「早A」→「早番A」）が 1 つだけならそれ。
 * 1 文字や英数字だけの略称（「C」「東」「D」）は施設ごとに意味が違うので、同じ名前でなければ当てない（選ばせる）。
 */
export function matchSlot(cell: string, slots: RoleSlot[]): RoleSlot | null {
  const norm = (s: string) => z2h(s).replace(/番/g, "").replace(/\s/g, "");
  const c = norm(cell);
  if (!c) return null;
  const exact = slots.filter((s) => norm(s.name) === c);
  if (exact.length === 1) return exact[0];
  if ([...c].length < 2 || /^[A-Za-z0-9]+$/.test(c)) return null;
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

/** 名前の照らし方: 空白と（）を除いた表示名、姓、姓＋名の先頭（「佐藤み」→「佐藤 みき」）。2 人以上に当たれば決めない */
export function matchStaff(state: State, name: string): ID | null {
  const n = z2h(name)
    .replace(/\(.*?\)|（.*?）/g, "")
    .replace(/\s/g, "");
  if (!n) return null;
  const all = Object.values(state.staff);
  const flat = (s: string) => s.replace(/[\s　]/g, "");
  const full = all.filter((s) => flat(s.displayName) === n);
  if (full.length === 1) return full[0].id;
  const sur = all.filter((s) => s.surname === n);
  if (sur.length === 1) return sur[0].id;
  const prefix = all.filter((s) => flat(s.displayName).startsWith(n) && n.length > s.surname.length);
  if (prefix.length === 1) return prefix[0].id;
  return null;
}

/** 日付でない列のうち、名簿と照らせる名前がいちばん多い列を名前の列にする（左の 3 列まで見る） */
function pickNameColumn(state: State, rows: string[][], dateCols: (DateKey | null)[]): number {
  let best = 0;
  let bestHits = -1;
  for (let ci = 0; ci < Math.min(3, Math.max(...rows.map((r) => r.length), 1)); ci++) {
    if (dateCols[ci]) continue;
    const hits = rows.filter((r) => matchStaff(state, r[ci] ?? "")).length;
    if (hits > bestHits) {
      bestHits = hits;
      best = ci;
    }
  }
  return best;
}

export function parseRosterPaste(state: State, text: string, opts: RosterPasteOptions): RosterPasteResult {
  const out: RosterPasteResult = {
    dates: [],
    staffIds: [],
    cells: [],
    unmatchedNames: [],
    unknownCells: [],
    readMappings: [],
    offCellsSeen: [],
    skippedEmptyDates: [],
    skippedPastDates: [],
    errors: [],
  };
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) {
    if (text.trim()) out.errors.push("2 行以上（日付の行と、職員の行）を貼ってください。日付の行から下を選んでコピーしてください");
    return out;
  }
  // 日付の行: 1 行目に日付が無ければ 2 行目（1 行目がタイトルの表）
  let headerIdx = 0;
  let cols: (DateKey | null)[] = [];
  for (let i = 0; i < Math.min(2, lines.length - 1); i++) {
    const c = parseDateRow(splitCells(lines[i]), opts.year, opts.month);
    if (c.filter(Boolean).length >= 1) {
      headerIdx = i;
      cols = c;
      break;
    }
  }
  if (cols.filter(Boolean).length < 1) {
    out.errors.push("日付の行が見つかりません（1, 2, 3… か 11/1 の形）。日付の行から下を選んでコピーしてください");
    return out;
  }
  const rows = lines.slice(headerIdx + 1).map(splitCells);
  const nameCol = pickNameColumn(state, rows, cols);
  const slots = Object.values(state.roleSlots);
  const aliases = opts.aliases ?? {};
  const unknown = new Set<string>();
  const offSeen = new Set<string>();
  const mappings = new Map<string, string>();
  const matched: { staffId: ID; cells: string[] }[] = [];
  rows.forEach((cells, idx) => {
    const name = cells[nameCol] ?? "";
    if (!name) return;
    const staffId = matchStaff(state, name);
    if (!staffId) {
      out.unmatchedNames.push({ line: headerIdx + idx + 2, name });
      return;
    }
    out.staffIds.push(staffId);
    matched.push({ staffId, cells });
  });
  // 日ごとに: 今日より前は変えない。照らせた職員のマスが全部空欄の日は入れない
  const useDate = new Map<number, DateKey>();
  cols.forEach((date, ci) => {
    if (!date || ci === nameCol) return;
    if (opts.today && date < opts.today) {
      out.skippedPastDates.push(date);
      return;
    }
    const allEmpty = matched.length > 0 && matched.every((m) => z2h(m.cells[ci] ?? "") === "");
    if (allEmpty) {
      out.skippedEmptyDates.push(date);
      return;
    }
    useDate.set(ci, date);
  });
  out.dates = [...useDate.values()];
  for (const m of matched) {
    const st = state.staff[m.staffId];
    // 初回の印: スポットで、これまで出勤が無く、この表の中でも最初の出勤日だけ
    let firstGiven = false;
    const hadBefore = Object.values(state.roster).some((e) => e.staffId === m.staffId && !e.absent && (out.dates[0] ? e.date < out.dates[0] : true));
    for (const [ci, date] of useDate) {
      const c = z2h(m.cells[ci] ?? "");
      if (isOffCell(c)) {
        offSeen.add(c === "" ? "空欄" : c);
        out.cells.push({ date, staffId: m.staffId, firstTimer: false });
        continue;
      }
      const alias = aliases[c];
      if (alias === "off") {
        out.cells.push({ date, staffId: m.staffId, firstTimer: false });
        continue;
      }
      const slot = alias ? state.roleSlots[alias] : matchSlot(c, slots);
      if (!slot) {
        unknown.add(c);
        continue;
      }
      if (!alias) mappings.set(c, slot.name);
      const firstTimer = st?.role === "スポット" && !hadBefore && !firstGiven;
      if (firstTimer) firstGiven = true;
      out.cells.push({ date, staffId: m.staffId, slotId: slot.id, firstTimer });
    }
  }
  out.unknownCells = [...unknown];
  out.offCellsSeen = [...offSeen];
  out.readMappings = [...mappings].filter(([c, n]) => c !== n).map(([cell, slotName]) => ({ cell, slotName }));
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
    const entry: RosterEntry = {
      id: ctx.newId(),
      date: c.date,
      staffId: c.staffId,
      ...(slot ? { slotId: slot.id } : {}),
      startMin: slot?.defaultStartMin ?? 9 * 60,
      endMin: slot?.defaultEndMin ?? 18 * 60,
      firstTimer: c.firstTimer,
      absent: !slot,
    };
    events.push({ ...metaOf(ctx), type: "roster.upsert", entry });
  }
  return events;
}

/** 「12/1」の形 */
export function shortDay(d: DateKey): string {
  return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
}

/** トーストの文 */
export function rosterPasteLabel(parsed: RosterPasteResult): string {
  const first = parsed.dates[0];
  const last = parsed.dates[parsed.dates.length - 1];
  return `勤務表を入れました（${shortDay(first)}〜${shortDay(last)}・${parsed.staffIds.length}人）`;
}
