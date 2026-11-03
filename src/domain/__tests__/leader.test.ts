import { test } from "node:test";
import assert from "node:assert/strict";

import { himawariSeed } from "../seed/index.ts";
import { deterministicContext, stateFromSeed } from "../loadSeed.ts";
import { absenceChoices, absenceKind, allRows, canSeeAll, candidatesForPreview, escortChoices, escortTemplateId, touchedTaskIds, unfilledCount } from "../leader.ts";
import { absencePreview, defaultEscortRange, escortPreview } from "../commands.ts";
import { applyEvents } from "../reducer.ts";
import { toMin } from "../time.ts";

const DATE = "2026-11-03";
const state = () => stateFromSeed(himawariSeed, deterministicContext("h"));

test("全体を見られるのは、リーダーの番の人（早番A・遅番・夜勤東）", () => {
  const s = state();
  assert.equal(canSeeAll(s, DATE, "stf-sato"), true);
  assert.equal(canSeeAll(s, DATE, "stf-kimura"), true);
  assert.equal(canSeeAll(s, DATE, "stf-takahashi"), false);
  // 欠勤の人には出さない
  assert.equal(canSeeAll(s, DATE, "stf-watanabe"), false);
});

test("施設がリーダーの番を決めていなければ、出勤している人に全体を出す", () => {
  const s = state();
  for (const slot of Object.values(s.roleSlots)) delete slot.leaderRank;
  assert.equal(canSeeAll(s, DATE, "stf-takahashi"), true);
});

test("全体の一覧: 時間順。休憩にはバッジを付けない。未充足の件数は見出しと同じ", () => {
  const s = state();
  const rows = allRows(s, DATE, toMin(10, 12));
  assert.ok(rows.length > 10);
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].task.startMin <= rows[i].task.startMin, "開始の時刻順");
  for (const r of rows.filter((x) => x.isBreak)) {
    assert.equal(r.unfilled, false, "休憩は埋める枠ではない");
    assert.doesNotMatch(r.label, /[①-⑳]/, "休憩の丸数字は外す");
  }
  assert.ok(unfilledCount(rows) > 0, "サンプルには担当未定・担当あと n 人の枠がある");
  assert.ok(rows.some((r) => r.past), "時刻を過ぎた行がある");
});

test("中止した業務は一覧に残り、未充足に数えない", () => {
  const s = state();
  const target = allRows(s, DATE, toMin(10)).find((r) => r.unfilled)!;
  const after = applyEvents(s, [
    { eventId: "e1", ts: "2026-11-03T10:00:00+09:00", batchId: "b1", type: "task.update", id: target.task.id, patch: { status: "cancelled" } },
  ]);
  const row = allRows(after, DATE, toMin(10)).find((r) => r.task.id === target.task.id)!;
  assert.equal(row.cancelled, true);
  assert.equal(row.unfilled, false);
});

test("付き添い: 既定（受診の付き添い・今から90分・担当は空き）で足すと、その行が変わった行になる", () => {
  const s = state();
  const ctx = deterministicContext("esc", "2026-11-03T10:12:00+09:00", "b-esc");
  const range = defaultEscortRange(toMin(10, 12));
  assert.deepEqual(range, { startMin: toMin(10, 15), endMin: toMin(11, 45) });
  const tplId = escortTemplateId(s, "受診の付き添い");
  assert.ok(tplId, "業務の種類から手順を引き継ぐ");
  const p = escortPreview(s, { date: DATE, residentId: "res-203-tanaka", templateId: tplId, ...range }, ctx);
  const add = p.events.find((e) => e.type === "task.add");
  assert.ok(add && add.type === "task.add");
  assert.deepEqual(touchedTaskIds(s, p.events).includes(add.task.id), true);
  assert.ok(p.lines.some((l) => l.text.includes("担当未定")), "結果として担当未定が出る");
  // 足す前の業務に付けられる人（問題なしが先頭）
  const cands = candidatesForPreview(s, p.events, add.task.id);
  assert.ok(cands.length > 0);
  assert.equal(cands[0].tier, "ok");
});

test("欠勤・早退: 勤務前は欠勤、勤務中は早退。選べる人に欠勤の人は入らない", () => {
  const s = state();
  const choices = absenceChoices(s, DATE);
  assert.ok(!choices.some((c) => c.staff.id === "stf-watanabe"));
  const kimura = choices.find((c) => c.staff.id === "stf-kimura")!;
  assert.equal(absenceKind(kimura.entry, toMin(10)), "欠勤");
  const sato = choices.find((c) => c.staff.id === "stf-sato")!;
  assert.equal(absenceKind(sato.entry, toMin(10)), "早退");
  const ctx = deterministicContext("abs", "2026-11-03T10:12:00+09:00", "b-abs");
  assert.equal(absencePreview(s, DATE, "stf-kimura", ctx, toMin(10)).title, "欠勤");
  const before = s;
  const p = absencePreview(s, DATE, "stf-sato", ctx, toMin(10, 12));
  assert.equal(p.title, "早退");
  assert.ok(touchedTaskIds(before, p.events).length > 0, "外した担当の業務が変わった行になる");
});

test("付き添いで選べる利用者は、表示名の設定（既定: 部屋番号＋姓）で「様」を付ける", () => {
  const s = state();
  const list = escortChoices(s);
  assert.ok(list.some((x) => x.label === "203 田中様"));
});
