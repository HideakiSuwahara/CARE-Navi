import { test } from "node:test";
import assert from "node:assert/strict";

import { himawariSeed } from "../seed/index.ts";
import { deterministicContext, stateFromSeed } from "../loadSeed.ts";
import { swapChoices, swapPreview } from "../commands.ts";
import { assignmentsOf, tasksForDate } from "../checks.ts";
import { applyEvents } from "../reducer.ts";

const DATE = "2026-11-03";
const state = () => stateFromSeed(himawariSeed, deterministicContext("h"));

/** 時間の重なるほかの枠に相手がいる、最初の担当を探す */
function firstSwappable(s: ReturnType<typeof state>) {
  for (const t of tasksForDate(s, DATE)) {
    if (t.kind === "break") continue;
    for (const a of assignmentsOf(s, t.id)) {
      const ch = swapChoices(s, t.id, a.staffId);
      if (ch.length > 0) return { a: { taskId: t.id, staffId: a.staffId }, b: ch[0] };
    }
  }
  throw new Error("入れ替えられる組が無い");
}

test("入れ替えの相手は、時間の重なるほかの枠の担当の人（休憩・同じ枠の人・自分は出さない）", () => {
  const s = state();
  const { a } = firstSwappable(s);
  const x = s.tasks[a.taskId];
  const inX = new Set(assignmentsOf(s, x.id).map((v) => v.staffId));
  for (const c of swapChoices(s, a.taskId, a.staffId)) {
    const y = s.tasks[c.taskId];
    assert.notEqual(y.id, x.id);
    assert.notEqual(y.kind, "break");
    assert.ok(y.startMin < x.endMin && x.startMin < y.endMin, "時間が重なる");
    assert.ok(!inX.has(c.staffId), "同じ枠の人は出さない");
    assert.notEqual(c.staffId, a.staffId);
  }
});

test("入れ替えは 1 バッチ: X は B に、Y は A に。人数は変わらない", () => {
  const s = state();
  const { a, b } = firstSwappable(s);
  const before = { x: assignmentsOf(s, a.taskId).length, y: assignmentsOf(s, b.taskId).length };
  const p = swapPreview(s, a, b, deterministicContext("sw", "2026-11-03T10:00:00+09:00", "batch-swap"));
  assert.ok(p.events.every((e) => e.batchId === "batch-swap"));
  assert.equal(p.lines.length, 2);
  assert.match(p.label, /担当を入れ替えました/);
  const after = applyEvents(s, p.events);
  const xs = assignmentsOf(after, a.taskId).map((v) => v.staffId);
  const ys = assignmentsOf(after, b.taskId).map((v) => v.staffId);
  assert.ok(xs.includes(b.staffId) && !xs.includes(a.staffId));
  assert.ok(ys.includes(a.staffId) && !ys.includes(b.staffId));
  assert.equal(xs.length, before.x);
  assert.equal(ys.length, before.y);
});

test("やった人を変える（決定記録 0022）: 代わりの人を担当にして「終わった」の印。1 バッチ", async () => {
  const { doerChoices, doneByEvents } = await import("../commands.ts");
  const s = state();
  const t = tasksForDate(s, DATE).find((x) => x.kind !== "break" && assignmentsOf(s, x.id).length === 1 && !x.done)!;
  const a = assignmentsOf(s, t.id)[0].staffId;
  const ch = doerChoices(s, t.id, a);
  assert.ok(ch.length > 0);
  assert.ok(!ch.some((c) => c.staffId === a), "いまの担当の人は出さない");
  const r = doneByEvents(s, t.id, ch[0].staffId, a, deterministicContext("d", "2026-11-03T10:00:00+09:00", "b-doer"));
  assert.ok(r.events.every((e) => e.batchId === "b-doer"));
  const after = applyEvents(s, r.events);
  assert.deepEqual(assignmentsOf(after, t.id).map((v) => v.staffId), [ch[0].staffId]);
  assert.equal(after.tasks[t.id].done, true);
  assert.match(r.label, /代わりに/);
});

test("やった人を変える: 担当未定の枠でも、やった人を担当にして印を付ける", async () => {
  const { doerChoices, doneByEvents } = await import("../commands.ts");
  const s = state();
  const t = tasksForDate(s, DATE).find((x) => x.kind !== "break" && assignmentsOf(s, x.id).length === 0)!;
  const ch = doerChoices(s, t.id);
  const r = doneByEvents(s, t.id, ch[0].staffId, undefined, deterministicContext("d2"));
  const after = applyEvents(s, r.events);
  assert.deepEqual(assignmentsOf(after, t.id).map((v) => v.staffId), [ch[0].staffId]);
  assert.equal(after.tasks[t.id].done, true);
});

test("始まったかは業務日の分で比べる（夜中の 2:10 は 翌2:10。ループ 20）", async () => {
  const { taskStarted } = await import("../checks.ts");
  const s = state();
  const night = tasksForDate(s, DATE).find((x) => x.startMin >= 24 * 60 && x.startMin < 24 * 60 + 2 * 60)!;
  assert.ok(night, "翌0:00〜翌2:00 に始まる枠がある");
  assert.equal(taskStarted(night, DATE, 2 * 60 + 10), true);
  assert.equal(taskStarted(night, DATE, 22 * 60), false);
});
