import { test } from "node:test";
import assert from "node:assert/strict";

import { himawariSeed } from "../seed/index.ts";
import { deterministicContext, stateFromSeed } from "../loadSeed.ts";
import { boardColumns, residentColumns, residentViewGroup, staffViewRows } from "../layout.ts";
import { inGroupView, shortageGroups, tasksForDate } from "../checks.ts";

// 決定記録 0017: 見るグループ・横軸［利用者］
const state = () => stateFromSeed(himawariSeed, deterministicContext("v"));
const DATE = "2026-11-03";

test("見るグループを選ぶと、そのグループと共通の列だけになる", () => {
  const s = state();
  const sakura = Object.values(s.groups).find((g) => g.name.includes("さくら"))!;
  const cols = boardColumns(s, DATE, 0, sakura.id);
  const kinds = cols.map((c) => s.groups[c.id]?.kind);
  assert.ok(cols.some((c) => c.id === sakura.id));
  assert.ok(kinds.every((k) => k === "unit" || k === "common"));
  assert.equal(cols.length, 2);
  assert.ok(boardColumns(s, DATE, 0).length > 2, "すべてなら全部");
});

test("見出しの担当未定の件数は見ているグループの分だけ", () => {
  const s = state();
  const sakura = Object.values(s.groups).find((g) => g.name.includes("さくら"))!;
  const all = shortageGroups(s, DATE).reduce((n, g) => n + g.count, 0);
  const mine = shortageGroups(s, DATE, sakura.id).reduce((n, g) => n + g.count, 0);
  const expected = tasksForDate(s, DATE).filter((t) => inGroupView(s, t, sakura.id));
  assert.ok(mine <= all);
  assert.ok(expected.length < tasksForDate(s, DATE).length);
});

test("横軸［利用者］: そのグループの方が列に並び、個別の枠とその方が入っている一括の枠が出る。休憩は出ない", () => {
  const s = state();
  const gid = residentViewGroup(s, Object.values(s.groups).find((g) => g.name.includes("さくら"))!.id)!;
  const residents = Object.values(s.residents).filter((r) => r.groupId === gid);
  const cols = residentColumns(s, DATE, gid, (r) => r.surname);
  assert.equal(cols.length, residents.length);
  assert.ok(cols.every((c) => c.name.endsWith("様") && !c.name.endsWith(" 様")));
  const cards = cols.flatMap((c) => c.cards.map((x) => x.task));
  assert.ok(cards.length > 0);
  assert.ok(cards.every((t) => t.kind !== "break"));
  // 一括の枠は、対象の方の数だけ列に出る（同じ 1 枚）
  const group = cards.find((t) => t.targetMode === "group");
  if (group) assert.equal(cards.filter((t) => t.id === group.id).length, (s.targets[group.id] ?? []).filter((rid) => s.residents[rid]?.groupId === gid).length);
  // その方の列の枠は、その方が対象
  for (const c of cols) for (const x of c.cards) assert.ok((s.targets[x.task.id] ?? []).includes(c.id));
});

test("横軸［利用者］で「すべて」なら、利用者のいる最初のグループを既定で選ぶ", () => {
  const s = state();
  const gid = residentViewGroup(s, undefined);
  assert.ok(gid);
  assert.ok(Object.values(s.residents).some((r) => r.groupId === gid));
  assert.equal(s.groups[gid].kind, "unit", "利用者のいるユニットを先に");
});

test("［職員］の絞り込み: そのグループに所属するか、そのグループの枠を担当している出勤者だけ", () => {
  const s = state();
  const sakura = Object.values(s.groups).find((g) => g.name.includes("さくら"))!;
  const all = staffViewRows(s, DATE);
  const rows = staffViewRows(s, DATE, sakura.id);
  assert.ok(rows.length > 0 && rows.length < all.length);
  for (const r of rows) {
    const st = s.staff[r.staffId];
    const entry = Object.values(s.roster).find((e) => e.date === DATE && e.staffId === r.staffId && !e.absent);
    assert.ok(!st.homeGroupId || st.homeGroupId === sakura.id || (entry?.slotId && s.roleSlots[entry.slotId]?.groupId === sakura.id) || r.bars.some((b) => b.task.groupId === sakura.id));
  }
  // 所属の無い出勤者（介護助手・看護など）はどのグループにも出る
  for (const r of all.filter((x) => !s.staff[x.staffId].homeGroupId)) {
    assert.ok(rows.some((x) => x.staffId === r.staffId));
  }
});

test("横軸［利用者］に共通の枠は出ない", () => {
  const s = state();
  const gid = residentViewGroup(s, undefined)!;
  const cards = residentColumns(s, DATE, gid, (r) => r.surname).flatMap((c) => c.cards.map((x) => x.task));
  assert.ok(cards.every((t) => !t.groupId || s.groups[t.groupId]?.kind !== "common"));
});

test("続けて埋める: 次の担当が決まっていない枠は、見ているグループの中で時刻の順にいまの枠の後ろ（最後まで行ったら最初へ）", async () => {
  const { nextUnfilledTask, headcountStatus } = await import("../checks.ts");
  const s = state();
  const unfilled = tasksForDate(s, DATE).filter((t) => t.kind !== "break" && ["unassigned", "short"].includes(headcountStatus(s, t.id).level));
  assert.ok(unfilled.length >= 2);
  const first = unfilled[0];
  const next = nextUnfilledTask(s, DATE, first.id)!;
  assert.notEqual(next.id, first.id);
  assert.ok(next.startMin >= first.startMin);
  const last = unfilled[unfilled.length - 1];
  assert.equal(nextUnfilledTask(s, DATE, last.id)?.id, first.id, "最後まで行ったら最初へ");
  const sakura = Object.values(s.groups).find((g) => g.name.includes("さくら"))!;
  const inSakura = nextUnfilledTask(s, DATE, first.id, sakura.id);
  if (inSakura) assert.ok(inGroupView(s, inSakura, sakura.id));
});
