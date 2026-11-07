import { test } from "node:test";
import assert from "node:assert/strict";
import { businessDateOf, calendarDateOf } from "../time.ts";

test("端末の日付と、ボードの一日としての今日（6:00 より前は前の日）", () => {
  assert.equal(calendarDateOf(new Date(2026, 10, 5, 9, 0)), "2026-11-05");
  assert.equal(businessDateOf(new Date(2026, 10, 5, 9, 0)), "2026-11-05");
  assert.equal(businessDateOf(new Date(2026, 10, 5, 6, 0)), "2026-11-05");
  assert.equal(businessDateOf(new Date(2026, 10, 5, 5, 59)), "2026-11-04");
  assert.equal(businessDateOf(new Date(2026, 11, 1, 3, 0)), "2026-11-30", "月をまたぐ");
  assert.equal(businessDateOf(new Date(2027, 0, 1, 2, 0)), "2026-12-31", "年をまたぐ");
});

test("業務表から作る: 番の人が業務の条件を持たなければ付けず、conditionSkips に出る（決定記録 0024）", async () => {
  const { himawariSeed } = await import("../seed/index.ts");
  const { stateFromSeed, deterministicContext } = await import("../loadSeed.ts");
  const { applyPatternEvents, conditionSkips } = await import("../pattern.ts");
  const { applyEvents } = await import("../reducer.ts");
  const { tasksForDate, assignmentsOf, rosterForDate } = await import("../checks.ts");
  const s = stateFromSeed(himawariSeed, deterministicContext("cs"));
  const D = "2026-11-03";
  const pid = Object.values(s.patterns)[0].id;
  const after0 = applyEvents(s, applyPatternEvents(s, D, pid, deterministicContext("p0")));
  const t = tasksForDate(after0, D).find((x) => x.requiredTags.length > 0 && assignmentsOf(after0, x.id).length > 0)!;
  assert.ok(t, "条件のある業務に担当が付いている");
  const who = assignmentsOf(after0, t.id)[0].staffId;
  // その人から条件を外して作り直すと、付かない
  const s2 = { ...s, staff: { ...s.staff, [who]: { ...s.staff[who], tags: s.staff[who].tags.filter((x) => !t.requiredTags.includes(x)) } } };
  const after = applyEvents(s2, applyPatternEvents(s2, D, pid, deterministicContext("p1")));
  const t2 = tasksForDate(after, D).find((x) => x.name === t.name && x.startMin === t.startMin)!;
  assert.ok(!assignmentsOf(after, t2.id).some((a) => a.staffId === who));
  assert.ok(conditionSkips(after, D).some((k) => k.staffId === who && k.task.id === t2.id));
  void rosterForDate;
});
