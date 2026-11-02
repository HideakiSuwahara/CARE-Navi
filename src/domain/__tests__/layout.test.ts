import { test } from "node:test";
import assert from "node:assert/strict";

import { boardColumns, layoutColumn } from "../layout.ts";
import { toMin } from "../time.ts";
import type { TaskInstance } from "../types.ts";
import { DATE, miniState } from "./fixture.ts";

function t(id: string, s: number, e: number): TaskInstance {
  return {
    id,
    date: DATE,
    name: id,
    kind: "care",
    targetMode: "none",
    startMin: s,
    endMin: e,
    headcount: 1,
    requiredTags: [],
    slotIds: [],
    status: "planned",
  };
}

test("重ならないカードは1段", () => {
  const out = layoutColumn([t("a", toMin(9), toMin(10)), t("b", toMin(10), toMin(11))]);
  assert.deepEqual(
    out.map((c) => [c.task.id, c.lane, c.lanes]),
    [
      ["a", 0, 1],
      ["b", 0, 1],
    ],
  );
});

test("重なるカードは横に並び、長い継続業務が左に来る", () => {
  const watch = t("watch", toMin(9), toMin(11));
  const diaper = t("diaper", toMin(10), toMin(10, 30));
  const bath = t("bath", toMin(10, 30), toMin(12));
  const out = layoutColumn([diaper, bath, watch]);
  const by = Object.fromEntries(out.map((c) => [c.task.id, c]));
  assert.equal(by.watch.lane, 0);
  assert.equal(by.diaper.lane, 1);
  assert.equal(by.bath.lane, 1, "おむつ交換が終わった段を使う");
  assert.equal(by.watch.lanes, 2);
  assert.equal(by.bath.lanes, 2);
});

test("塊が切れたら段数は数え直す", () => {
  const out = layoutColumn([t("a", 0, 60), t("b", 30, 90), t("c", 120, 180)]);
  const by = Object.fromEntries(out.map((c) => [c.task.id, c]));
  assert.equal(by.a.lanes, 2);
  assert.equal(by.c.lanes, 1);
  assert.equal(by.c.lane, 0);
});

test("ボードの列はグループ順で、共通には休憩・対象なしの業務が入る", () => {
  const s = miniState();
  const cols = boardColumns(s, DATE);
  assert.deepEqual(
    cols.map((c) => c.name),
    ["東フロア", "共通"],
  );
  const common = cols.find((c) => c.name === "共通")!;
  assert.deepEqual(
    common.cards.map((c) => c.task.name).sort(),
    ["リネン回収", "休憩①"].sort(),
  );
  assert.equal(cols[0].sub, "3人");
});

test("パレット: 出勤者は番の順。休みの人は、その番の未充足の枠数だけを持つ（件数・時間は持たない）", async () => {
  const { paletteRows } = await import("../layout.ts");
  const s = miniState();
  const { working, off } = paletteRows(s, DATE);
  assert.deepEqual(
    working.map((r) => `${r.surname}:${r.slotName}`),
    ["佐藤:早番A", "鈴木:日勤A", "加藤:スポット(午後)"],
  );
  assert.equal(working.find((r) => r.surname === "加藤")?.firstTimer, true);
  assert.equal(off.length, 1);
  assert.equal(off[0].surname, "渡辺");
  assert.equal(off[0].unfilledSlotTasks, 2, "入浴（あと1人）とリネン回収（担当未定）");
  assert.deepEqual(off[0].slotTaskLabels, [
    { label: "担当未定", count: 1 },
    { label: "担当あと1人", count: 1 },
  ]);
  assert.ok(!("load" in working[0]), "人に件数を付けない");
});

test("2時間以上の継続業務（見守り）は左のレールへ。休憩はレールに入れない", async () => {
  const { layoutGroupColumn } = await import("../layout.ts");
  const watch = t("watch", toMin(9), toMin(11));
  const diaper = t("diaper", toMin(10), toMin(10, 30));
  const brk = { ...t("break", toMin(11), toMin(13)), kind: "break" as const };
  const { cards, hasRail } = layoutGroupColumn([watch, diaper, brk]);
  assert.equal(hasRail, true);
  const by = Object.fromEntries(cards.map((c) => [c.task.id, c]));
  assert.equal(by.watch.rail, true);
  assert.equal(by.diaper.rail, undefined);
  assert.equal(by.diaper.lanes, 1, "見守りと重なっても、レールの外は1段");
  assert.equal(by.break.rail, undefined);
});

test("見出しのまとめは実際の文言ごと（担当未定 → 担当あと n 人）", async () => {
  const { shortageGroups } = await import("../checks.ts");
  const s = miniState();
  assert.deepEqual(shortageGroups(s, DATE), [
    { label: "担当未定", level: "unassigned", count: 1 },
    { label: "担当あと1人", level: "short", count: 2 },
  ]);
});

test("短い業務も最小の長さを占めるものとして並べる（15分の下に次の業務が重ならない）", () => {
  const a = t("a", toMin(13), toMin(13, 15));
  const b = t("b", toMin(13, 15), toMin(13, 45));
  assert.equal(layoutColumn([a, b]).find((c) => c.task.id === "b")!.lane, 0, "最小の長さなしなら同じ段");
  const out = layoutColumn([a, b], 20);
  const by = Object.fromEntries(out.map((c) => [c.task.id, c]));
  assert.notEqual(by.a.lane, by.b.lane, "最小20分なら横に並ぶ");
  assert.equal(by.a.lanes, 2);
});
