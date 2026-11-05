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
