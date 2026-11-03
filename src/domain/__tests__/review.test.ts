import { test } from "node:test";
import assert from "node:assert/strict";

import { himawariSeed } from "../seed/index.ts";
import { deterministicContext, stateFromSeed } from "../loadSeed.ts";
import { hourBuckets, hoursLabel, planItemsFor, weekOf, weekReview } from "../review.ts";
import { toMin } from "../time.ts";

const DATE = "2026-11-03";
const state = () => stateFromSeed(himawariSeed, deterministicContext("h"));

test("今週は月曜〜日曜", () => {
  assert.deepEqual(weekOf(DATE), ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"]);
});

test("時間割ができている日はその日の予定、まだの日は曜日の業務表から。休憩は含めない", () => {
  const s = state();
  const today = planItemsFor(s, DATE);
  assert.ok(today.length > 0 && today.every((i) => i.source === "day"));
  const tomorrow = planItemsFor(s, "2026-11-05");
  assert.ok(tomorrow.length > 0 && tomorrow.every((i) => i.source === "pattern"));
  assert.ok(![...today, ...tomorrow].some((i) => /休憩/.test(i.name)));
});

test("区分×時間帯: 予定時間 = 長さ × 必要人数。時間帯をまたぐ業務は分けて数える", () => {
  const b = hourBuckets([
    { date: DATE, name: "x", startMin: toMin(9, 30), endMin: toMin(10, 30), headcount: 2, kind: "noncore", slotIds: [], source: "day" },
  ]);
  const at9 = b.find((x) => x.startMin === toMin(9))!;
  const at10 = b.find((x) => x.startMin === toMin(10))!;
  assert.equal(at9.noncore, 60);
  assert.equal(at10.noncore, 60);
  assert.equal(b.length, 24);
  assert.equal(hoursLabel(90), "1.5");
  // 夜勤明けの 翌8:30–9:00 は時計の 8:00 の帯に入る
  const night = hourBuckets([{ date: DATE, name: "y", startMin: toMin(32, 30), endMin: toMin(33), headcount: 1, kind: "core", slotIds: [], source: "day" }]);
  assert.equal(night.find((x) => x.startMin === toMin(8))!.core, 30);
});

test("週の集計: 介護助手の勤務帯があり、ノンコアの枠は番別・枠別（人の名前は出さない）", () => {
  const s = state();
  const w = weekReview(s, DATE);
  assert.equal(w.dates.length, 7);
  assert.ok(w.totals.core > 0 && w.totals.noncore > 0);
  assert.equal(w.bands.length, 1);
  assert.equal(w.bands[0].name, "介護助手");
  assert.ok(w.noncore.length > 0);
  const names = Object.values(s.staff).map((x) => x.surname);
  for (const r of w.noncore) {
    assert.ok(r.dayCount >= 1);
    assert.ok(!names.some((n) => r.slotNames.includes(n)), "番の名前だけ");
    assert.equal(r.inBand.length, 1);
  }
  // 図の合計と枠一覧の合計（ノンコア）が合う
  assert.equal(w.noncore.reduce((n, r) => n + r.plannedMin, 0), w.totals.noncore);
});
