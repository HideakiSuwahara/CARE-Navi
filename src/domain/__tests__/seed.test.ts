import { test } from "node:test";
import assert from "node:assert/strict";

import { himawariSeed } from "../seed/index.ts";
import { deterministicContext, stateFromSeed } from "../loadSeed.ts";
import { headcountStatus, shortageSummary, tasksForDate } from "../checks.ts";
import { MAX_MINUTES } from "../types.ts";

const DATE = "2026-11-03";

test("ひまわり苑: 参照整合性（ID・時刻・姓の重なり）", () => {
  const s = himawariSeed;
  const residentIds = new Set(s.residents.map((r) => r.id));
  const staffIds = new Set(s.staff.map((r) => r.id));
  const slotIds = new Set(s.roleSlots.map((r) => r.id));
  const tplIds = new Set(s.templates.map((r) => r.id));
  const groupIds = new Set(s.groups.map((r) => r.id));

  assert.equal(residentIds.size, s.residents.length);
  assert.equal(staffIds.size, s.staff.length);
  for (const r of s.residents) assert.ok(groupIds.has(r.groupId), `group of ${r.id}`);
  for (const e of s.roster) {
    assert.ok(staffIds.has(e.staffId), `roster staff ${e.staffId}`);
    if (e.slotId) assert.ok(slotIds.has(e.slotId), `roster slot ${e.slotId}`);
    assert.ok(e.startMin < e.endMin && e.endMin <= MAX_MINUTES);
  }
  for (const p of s.patterns) {
    for (const it of p.items) {
      assert.ok(tplIds.has(it.templateId), `${p.name}: template ${it.templateId}`);
      assert.ok(it.startMin < it.endMin && it.endMin <= MAX_MINUTES, `${p.name}: ${it.id} time`);
      for (const sid of it.slotIds) assert.ok(slotIds.has(sid), `${p.name}: slot ${sid}`);
      if (it.groupId) assert.ok(groupIds.has(it.groupId), `${p.name}: group ${it.groupId}`);
      for (const rid of it.residentIds ?? []) assert.ok(residentIds.has(rid), `${p.name}: resident ${rid}`);
      assert.ok(it.headcount >= 0);
    }
  }
  const staffSurnames = new Set(s.staff.map((x) => x.surname));
  for (const r of s.residents) assert.ok(!staffSurnames.has(r.surname), `姓の重なり: ${r.surname}`);
});

test("ひまわり苑 11/3（入浴日）: 入浴は「担当あと1人」、介護助手の枠は「担当未定」", () => {
  const s = stateFromSeed(himawariSeed, deterministicContext("h"));
  const tasks = tasksForDate(s, DATE);
  assert.ok(tasks.length >= 40, `枠数 ${tasks.length}`);

  const bath = tasks.find((t) => t.name.startsWith("入浴介助") && t.targetMode === "group");
  assert.ok(bath, "一括の入浴介助がある");
  const hs = headcountStatus(s, bath!.id);
  assert.equal(hs.required, 3);
  assert.equal(hs.label, "担当あと1人");
  assert.equal((s.targets[bath!.id] ?? []).length, 6, "対象者6人を明示");

  const linen = tasks.find((t) => t.name === "リネン回収");
  assert.ok(linen);
  assert.equal(headcountStatus(s, linen!.id).label, "担当未定");

  const summary = shortageSummary(s, DATE);
  assert.ok(summary.unassigned >= 2, `担当未定 ${summary.unassigned}`);
});

test("ひまわり苑: 時間が過ぎても status は planned のまま（自動で完了にしない）", () => {
  const s = stateFromSeed(himawariSeed, deterministicContext("h"));
  for (const t of tasksForDate(s, DATE)) assert.equal(t.status, "planned");
});

test("ひまわり苑: 禁止している表現をデータに含まない", () => {
  const text = JSON.stringify(himawariSeed);
  // wording-ok: 禁止語がデータに含まれないことを確かめるための列挙
  for (const ng of ["人手不足", "完了率", "実施中", "採用必要"]) { // wording-ok
    assert.ok(!text.includes(ng), `禁止語: ${ng}`);
  }
});
