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
