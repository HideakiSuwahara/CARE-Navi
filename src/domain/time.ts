import { MAX_MINUTES, MINUTES_PER_DAY, type Minutes } from "./types.ts";

/** 時・分 → 業務日起点の分 */
export function toMin(hour: number, minute = 0): Minutes {
  return hour * 60 + minute;
}

/** 分 → "10:00" / "翌2:00" */
export function fmtMin(min: Minutes): string {
  const m = ((min % MAX_MINUTES) + MAX_MINUTES) % MAX_MINUTES;
  const nextDay = m >= MINUTES_PER_DAY;
  const inDay = nextDay ? m - MINUTES_PER_DAY : m;
  const h = Math.floor(inDay / 60);
  const mm = inDay % 60;
  return `${nextDay ? "翌" : ""}${h}:${mm.toString().padStart(2, "0")}`;
}

/** "10:00–10:30" */
export function fmtRange(startMin: Minutes, endMin: Minutes): string {
  return `${fmtMin(startMin)}–${fmtMin(endMin)}`;
}

/** 90 → "1時間30分"、30 → "30分"、120 → "2時間" */
export function fmtDuration(min: Minutes): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}分`;
  if (m === 0) return `${h}時間`;
  return `${h}時間${m}分`;
}

/** 半開区間 [aStart, aEnd) と [bStart, bEnd) が重なるか */
export function overlaps(aStart: Minutes, aEnd: Minutes, bStart: Minutes, bEnd: Minutes): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** [start, end) が [outerStart, outerEnd) に収まるか */
export function within(start: Minutes, end: Minutes, outerStart: Minutes, outerEnd: Minutes): boolean {
  return start >= outerStart && end <= outerEnd;
}

/** "9:30" / "09:30" / "翌2:00" → 分。不正なら null */
export function parseTime(text: string): Minutes | null {
  const t = text.trim();
  const next = t.startsWith("翌");
  const body = next ? t.slice(1) : t;
  const m = /^(\d{1,2}):(\d{2})$/.exec(body);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 23 || mm > 59) return null;
  return (next ? MINUTES_PER_DAY : 0) + h * 60 + mm;
}

/** 15分刻みに丸める（ずらす操作の既定） */
export function snapTo(min: Minutes, step: Minutes = 15): Minutes {
  return Math.round(min / step) * step;
}

export function clampMinutes(min: Minutes): Minutes {
  return Math.max(0, Math.min(MAX_MINUTES, min));
}

// ---------------------------------------------------------------------------
// 利用者の生活の時計（24時間シート用）
// 業務日の時刻（翌2:00 = 1560）は職員の勤務に合わせた表し方。24時間シートは利用者の一日なので、
// 「翌」を付けずに朝から並べる。
// ---------------------------------------------------------------------------

/** 24時間シートの一日の始まり（5:00）。この時刻から順に並べる */
export const SHEET_DAY_START: Minutes = 5 * 60;

/** 並べ順の鍵: 5:00 を 0 とした時計の順 */
export function clockSortKey(min: Minutes, dayStart: Minutes = SHEET_DAY_START): number {
  return (((min % MINUTES_PER_DAY) - dayStart) % MINUTES_PER_DAY + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/** 「翌」を付けない時刻。翌6:30 → "6:30" */
export function clockLabel(min: Minutes): string {
  return fmtMin(((min % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY);
}

/** 入力された時計の時刻を、基準の時刻（日課の標準）にいちばん近い業務日の時刻にする */
export function alignToReference(clockMin: Minutes, referenceMin: Minutes): Minutes {
  const base = ((clockMin % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const candidates = [base, base + MINUTES_PER_DAY];
  return candidates.reduce((best, c) => (Math.abs(c - referenceMin) < Math.abs(best - referenceMin) ? c : best));
}

/** 基準のない時刻（その方だけの行）: 一日の始まり（5:00）より前は翌日の時刻にする */
export function alignToSheetDay(clockMin: Minutes): Minutes {
  const base = ((clockMin % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return base < SHEET_DAY_START ? base + MINUTES_PER_DAY : base;
}
