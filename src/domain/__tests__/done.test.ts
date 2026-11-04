import { test } from "node:test";
import assert from "node:assert/strict";

import { himawariSeed } from "../seed/index.ts";
import { deterministicContext, stateFromSeed } from "../loadSeed.ts";
import { applyEvents, invertBatch } from "../reducer.ts";
import { setDoneEvents } from "../commands.ts";
import { unfinishedLabel, unfinishedTasks } from "../checks.ts";
import { allRows, unfinishedCount } from "../leader.ts";
import { myDay } from "../myday.ts";
import { toMin } from "../time.ts";

const DATE = "2026-11-03";
const state = () => stateFromSeed(himawariSeed, deterministicContext("h"));

test("「終わった」の印: 付ける・外す・元に戻す。時刻が過ぎただけでは付かない", () => {
  const s = state();
  const past = unfinishedTasks(s, DATE, toMin(10, 12));
  assert.ok(past.length > 0, "10:12 には時刻を過ぎた枠がある");
  for (const t of past) assert.equal(t.done, undefined, "印は人が付けるまで無い");
  const target = past[0];
  const ctx = deterministicContext("d", "2026-11-03T10:12:00+09:00", "b-done");
  const evs = setDoneEvents(target.id, true, ctx);
  const s2 = applyEvents(s, evs);
  assert.equal(s2.tasks[target.id].done, true);
  assert.equal(unfinishedTasks(s2, DATE, toMin(10, 12)).length, past.length - 1);
  // 元に戻す（打ち消し）
  const inverse = invertBatch(evs.map((event) => ({ event, before: s })), "b-done");
  const s3 = applyEvents(s2, inverse);
  assert.equal(Boolean(s3.tasks[target.id].done), false);
  // 外す
  const s4 = applyEvents(s2, setDoneEvents(target.id, false, deterministicContext("e", "2026-11-03T10:13:00+09:00", "b-undone")));
  assert.equal(s4.tasks[target.id].done, false);
});

test("終わっていない n 件: 休憩・中止は数えない。担当未定とは別", () => {
  const s = state();
  const rows = allRows(s, DATE, toMin(15));
  const n = unfinishedCount(rows);
  assert.equal(n, unfinishedTasks(s, DATE, toMin(15)).length);
  for (const r of rows.filter((x) => x.unfinished)) {
    assert.equal(r.isBreak, false);
    assert.equal(r.cancelled, false);
    assert.equal(r.past, true);
    assert.equal(r.done, false);
  }
  assert.equal(unfinishedLabel(0), "");
  assert.equal(unfinishedLabel(3), "終わっていない 3件");
});

test("自分の予定の行にも印が出る", () => {
  const s = state();
  const d = myDay(s, DATE, "stf-sato", toMin(10, 12))!;
  const first = d.items[0];
  assert.equal(first.done, false);
  const s2 = applyEvents(s, setDoneEvents(first.task.id, true, deterministicContext("f", "2026-11-03T10:12:00+09:00", "b-f")));
  assert.equal(myDay(s2, DATE, "stf-sato", toMin(10, 12))!.items[0].done, true);
});
