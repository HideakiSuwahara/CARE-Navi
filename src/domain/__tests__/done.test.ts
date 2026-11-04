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

test("自分の予定の行にも印が出る。サンプルは 8:00 までの枠に印あり。見守りは印の対象外", () => {
  const s = state();
  const d = myDay(s, DATE, "stf-sato", toMin(10, 12))!;
  // サンプルの印: 申し送り 7:00–7:30 は付いている（seed の doneMarks）。朝食介助 8:00–9:00 は付いていない
  assert.equal(d.items[0].done, true);
  const target = d.items.find((i) => !i.done && i.canDone)!;
  assert.ok(target, "印の無い枠がある");
  const idx = d.items.indexOf(target);
  const s2 = applyEvents(s, setDoneEvents(target.task.id, true, deterministicContext("f", "2026-11-03T10:12:00+09:00", "b-f")));
  assert.equal(myDay(s2, DATE, "stf-sato", toMin(10, 12))!.items[idx].done, true);
  // 見守り・休憩は印の対象外
  for (const i of d.items.filter((x) => x.isBreak || x.task.name.startsWith("見守り"))) assert.equal(i.canDone, false);
});

test("終わりの時刻から 15 分は「終わっていない」に数えない。見守りは数えない", () => {
  const s = state();
  // 朝食介助 8:00–9:00: 9:10 ではまだ数えず、9:15 から数える
  const name = (t: { name: string }) => t.name;
  assert.ok(!unfinishedTasks(s, DATE, toMin(9, 10)).map(name).includes("朝食介助"));
  assert.ok(unfinishedTasks(s, DATE, toMin(9, 15)).map(name).includes("朝食介助"));
  for (const t of unfinishedTasks(s, DATE, toMin(23))) assert.ok(!t.name.startsWith("見守り"), t.name);
  // サンプルは 10:12 に「終わっていない 2件」（朝食介助・バイタル測定）。8:00 までの枠は印あり
  assert.deepEqual(unfinishedTasks(s, DATE, toMin(10, 12)).map(name).sort(), ["バイタル測定", "朝食介助"]);
});
