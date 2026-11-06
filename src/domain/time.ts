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

/**
 * 人が打った時刻を読む（入力欄用）。parseTime の書き方に加えて、
 * 「730」「0730」「7時30分」「7時半」「7時」「7.30」「7：30」（全角）も 7:30 のように読む。不正なら null。
 */
export function parseClockInput(text: string): Minutes | null {
  const t = text
    .trim()
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[：﹕]/g, ":")
    .replace(/[．。]/g, ".")
    .replace(/\s+/g, "");
  const next = t.startsWith("翌");
  const body = next ? t.slice(1) : t;
  let h: number;
  let mm: number;
  let m: RegExpExecArray | null;
  if ((m = /^(\d{1,2})[:.](\d{2})$/.exec(body))) {
    h = Number(m[1]);
    mm = Number(m[2]);
  } else if ((m = /^(\d{1,2})時(?:(\d{1,2})分?|(半))?$/.exec(body))) {
    h = Number(m[1]);
    mm = m[3] ? 30 : m[2] ? Number(m[2]) : 0;
  } else if ((m = /^(\d{3,4})$/.exec(body))) {
    h = Number(m[1].slice(0, -2));
    mm = Number(m[1].slice(-2));
  } else if ((m = /^(\d{1,2})$/.exec(body))) {
    h = Number(m[1]);
    mm = 0;
  } else {
    return null;
  }
  if (h > 23 || mm > 59) return null;
  return (next ? MINUTES_PER_DAY : 0) + h * 60 + mm;
}

/** 端末の時計の日付（"2026-11-05"）。端末のタイムゾーン（施設の時刻）で読む */
export function calendarDateOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** ボードの一日（6:00〜翌6:00）としての今日。6:00 より前は前の日の業務日（夜勤帯はその夜勤が始まった日に属する） */
export function businessDateOf(d: Date): string {
  if (d.getHours() >= 6) return calendarDateOf(d);
  return calendarDateOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 12));
}

/** 時計の分（0–1439）を業務日の分へ。6:00 より前は前の日の夜勤帯（翌0:00〜翌6:00）。既に業務日の分（1440 以上）ならそのまま */
export function businessMinutes(clockMin: Minutes): Minutes {
  return clockMin < 6 * 60 ? clockMin + 24 * 60 : clockMin;
}
