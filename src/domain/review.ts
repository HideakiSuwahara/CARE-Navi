/**
 * 業務の見直し（PC、今週）の集計。docs/screens.md §2、決定記録 0004 §8・0008
 * - 数字は「予定時間ベース」: 時間割ができている日はその日の予定、まだの日は曜日の業務表から計算する。実施時間ではない。
 * - 数字は業務に付ける。人には付けない（職員ごとの集計は作らない）。
 * - 休憩は含めない。中止は含めない。
 * - 予定時間 = 業務の長さ × 必要人数（施設が決めた予定値）。
 */

import { tasksForDate } from "./checks.ts";
import { addDays, patternForDate, weekdayOf } from "./pattern.ts";
import { fmtRange } from "./time.ts";
import type { CategoryKind, DateKey, ID, Minutes, State } from "./types.ts";

/** 見直しの集計に使う1件（当日の予定 or 業務表の項目） */
export interface PlanItem {
  date: DateKey;
  name: string;
  groupId?: ID;
  startMin: Minutes;
  endMin: Minutes;
  headcount: number;
  kind: CategoryKind;
  slotIds: ID[];
  /** "day" = その日の時間割から／"pattern" = 曜日の業務表から */
  source: "day" | "pattern";
}

const WD = "日月火水木金土";

/** その日を含む週（月曜〜日曜） */
export function weekOf(date: DateKey): DateKey[] {
  const wd = weekdayOf(date);
  const monday = addDays(date, -((wd + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function weekLabel(dates: DateKey[]): string {
  const f = (d: DateKey) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}（${WD[weekdayOf(d)]}）`;
  return `${f(dates[0])}〜${f(dates[dates.length - 1])}`;
}

function kindOf(state: State, categoryId?: ID): CategoryKind {
  if (!categoryId) return "other";
  return state.facility?.settings.categories.find((c) => c.id === categoryId)?.kind ?? "other";
}

/** その日の予定（休憩・中止を除く）。時間割がまだの日は曜日の業務表から */
export function planItemsFor(state: State, date: DateKey): PlanItem[] {
  const tasks = tasksForDate(state, date);
  if (tasks.length > 0) {
    return tasks
      .filter((t) => t.kind !== "break")
      .map((t) => ({
        date,
        name: t.name,
        groupId: t.groupId,
        startMin: t.startMin,
        endMin: t.endMin,
        headcount: t.headcount,
        kind: kindOf(state, t.categoryId),
        slotIds: t.slotIds,
        source: "day" as const,
      }));
  }
  const pid = patternForDate(state, date);
  const pattern = pid ? state.patterns[pid] : undefined;
  if (!pattern) return [];
  const out: PlanItem[] = [];
  for (const it of pattern.items) {
    const tpl = state.templates[it.templateId];
    if (!tpl || tpl.kind === "break") continue;
    out.push({
      date,
      name: tpl.name,
      groupId: it.groupId,
      startMin: it.startMin,
      endMin: it.endMin,
      headcount: it.headcount,
      kind: kindOf(state, tpl.categoryId),
      slotIds: it.slotIds,
      source: "pattern",
    });
  }
  return out;
}

export interface HourBucket {
  /** 時計の時刻（分）。6:00〜翌5:00 の 24 本。夜勤明けの業務（翌8:30 など）は時計の 8:00 の帯に入る */
  startMin: Minutes;
  /** 区分ごとの予定時間（分） */
  core: number;
  noncore: number;
  other: number;
}

/** 区分 × 時間帯（時計の1時間ごと、6:00 から 24 本）。週の合計（分） */
export function hourBuckets(items: PlanItem[], fromMin: Minutes = 6 * 60): HourBucket[] {
  const buckets: HourBucket[] = Array.from({ length: 24 }, (_, i) => ({ startMin: (fromMin + i * 60) % 1440, core: 0, noncore: 0, other: 0 }));
  for (const it of items) {
    for (const b of buckets) {
      // 業務日の分は 0〜2879。同じ時計の帯は c と c+1440 の 2 か所
      for (const base of [b.startMin, b.startMin + 1440]) {
        const s = Math.max(it.startMin, base);
        const e = Math.min(it.endMin, base + 60);
        if (e > s) b[it.kind] += (e - s) * it.headcount;
      }
    }
  }
  return buckets;
}

export interface Band {
  slotId: ID;
  name: string;
  startMin: Minutes;
  endMin: Minutes;
  /** 今週その番で出勤予定の日（勤務表が入っている日だけ。欠勤を除く） */
  days: { date: DateKey; startMin: Minutes; endMin: Minutes }[];
}

/** 介護助手等の勤務帯（reviewBand の番）。図の背景に重ねる */
export function reviewBands(state: State, dates: DateKey[]): Band[] {
  return Object.values(state.roleSlots)
    .filter((s) => s.reviewBand)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((s) => ({
      slotId: s.id,
      name: s.name,
      startMin: s.defaultStartMin,
      endMin: s.defaultEndMin,
      days: Object.values(state.roster)
        .filter((e) => e.slotId === s.id && !e.absent && dates.includes(e.date))
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((e) => ({ date: e.date, startMin: e.startMin, endMin: e.endMin })),
    }));
}

export interface NoncoreRow {
  key: string;
  name: string;
  groupName: string;
  startMin: Minutes;
  endMin: Minutes;
  /** 「月・水・木」 */
  weekdays: string;
  dayCount: number;
  slotNames: string[];
  /** 勤務帯ごとの［中｜外］。枠の時刻がその番の勤務帯にすっぽり入るか */
  inBand: { name: string; inside: boolean }[];
  /** 今週の予定時間（分）= 長さ × 必要人数 × 日数 */
  plannedMin: number;
}

/** ノンコアの枠の一覧（番別・枠別。個人別は作らない）。時刻順 */
export function noncoreRows(state: State, items: PlanItem[], bands: Band[]): NoncoreRow[] {
  const map = new Map<string, NoncoreRow & { dates: Set<DateKey> }>();
  for (const it of items) {
    if (it.kind !== "noncore") continue;
    const key = [it.name, it.groupId ?? "", it.startMin, it.endMin, [...it.slotIds].sort().join("+")].join("|");
    const cur =
      map.get(key) ??
      ({
        key,
        name: it.name,
        groupName: it.groupId && state.groups[it.groupId]?.kind !== "common" ? (state.groups[it.groupId]?.name ?? "") : "",
        startMin: it.startMin,
        endMin: it.endMin,
        weekdays: "",
        dayCount: 0,
        slotNames: it.slotIds.map((id) => state.roleSlots[id]?.name).filter((x): x is string => Boolean(x)),
        inBand: bands.map((b) => ({ name: b.name, inside: b.startMin <= it.startMin && it.endMin <= b.endMin })),
        plannedMin: 0,
        dates: new Set<DateKey>(),
      } as NoncoreRow & { dates: Set<DateKey> });
    cur.dates.add(it.date);
    cur.plannedMin += (it.endMin - it.startMin) * it.headcount;
    map.set(key, cur);
  }
  return [...map.values()]
    .map(({ dates, ...row }) => {
      const sorted = [...dates].sort();
      // 月曜はじまりで並べる
      const order = (d: DateKey) => (weekdayOf(d) + 6) % 7;
      sorted.sort((a, b) => order(a) - order(b));
      return { ...row, dayCount: sorted.length, weekdays: sorted.map((d) => WD[weekdayOf(d)]).join("・") };
    })
    .sort((a, b) => a.startMin - b.startMin || a.name.localeCompare(b.name, "ja"));
}

/** 「12.5 時間」の表記（予定時間。分 → 時間、小数1桁） */
export function hoursLabel(min: number): string {
  return `${(Math.round((min / 60) * 10) / 10).toFixed(1)}`;
}

export function rangeLabel(row: { startMin: Minutes; endMin: Minutes }): string {
  return fmtRange(row.startMin, row.endMin);
}

/** 今週の集計（画面はこれだけを呼ぶ） */
export function weekReview(state: State, date: DateKey) {
  const dates = weekOf(date);
  const items = dates.flatMap((d) => planItemsFor(state, d));
  const bands = reviewBands(state, dates);
  const buckets = hourBuckets(items);
  const totals = buckets.reduce((t, b) => ({ core: t.core + b.core, noncore: t.noncore + b.noncore, other: t.other + b.other }), { core: 0, noncore: 0, other: 0 });
  const fromDay = dates.filter((d) => tasksForDate(state, d).length > 0);
  return { dates, items, bands, buckets, totals, noncore: noncoreRows(state, items, bands), fromDay };
}
