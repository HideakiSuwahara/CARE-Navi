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
