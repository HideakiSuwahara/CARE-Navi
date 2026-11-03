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

test("時刻を過ぎた担当未定は見出しに数えない。誰もいない休憩カードは一覧に出さない", async () => {
  const { unfilledGroups } = await import("../leader.ts");
  const s = state();
  const early = allRows(s, DATE, toMin(6));
  const late = allRows(s, DATE, toMin(15));
  assert.ok(unfilledCount(late) <= unfilledCount(early));
  for (const r of late.filter((x) => x.past)) assert.equal(r.unfilled, false);
  assert.equal(unfilledGroups(late).reduce((n, g) => n + g.count, 0), unfilledCount(late));
  for (const r of late.filter((x) => x.isBreak)) assert.ok(r.assignees.length > 0);
});

test("ずらす前の確かめ: 時間割の外へは出さない。担当のほかの予定との重なりを一文で返す", async () => {
  const { shiftCheck } = await import("../leader.ts");
  const s = state();
  const first = allRows(s, DATE, 0).find((r) => !r.isBreak && r.assignees.length > 0)!;
  assert.equal(shiftCheck(s, first.task.id, -24 * 60).ok, false);
  const c = shiftCheck(s, first.task.id, 30);
  assert.equal(c.ok, true);
  assert.ok(c.conflicts.every((x) => x.includes("と重なります")));
});

test("欠勤・早退: 勤務開始の直後でも、来ていなければ欠勤を選べる。夜勤の人は朝の時刻なら欠勤", () => {
  const s = state();
  const ctx = deterministicContext("abs2", "2026-11-03T07:10:00+09:00", "b-abs2");
  assert.equal(absencePreview(s, DATE, "stf-takahashi", ctx, toMin(7, 10)).title, "早退");
  assert.equal(absencePreview(s, DATE, "stf-takahashi", ctx, toMin(7, 10), "absent").title, "欠勤");
  // 今夜 17:00 からの夜勤東の人に 7:00 の時点で連絡が来た → 欠勤（業務日の時刻で比べる）
  assert.equal(absencePreview(s, DATE, "stf-saito", ctx, toMin(7)).title, "欠勤");
});

test("付き添い: 一括の業務は対象の方から外す候補（既定はチェックなし）。端だけ重なる個別業務の中止も既定はチェックなし", () => {
  const s = state();
  const ctx = deterministicContext("esc2", "2026-11-03T10:00:00+09:00", "b-esc2");
  const p = escortPreview(s, { date: DATE, residentId: "res-203-tanaka", startMin: toMin(9, 15), endMin: toMin(10, 45) }, ctx);
  for (const l of p.lines.filter((x) => x.kind === "remove")) assert.equal(l.defaultOn, false);
  for (const l of p.lines.filter((x) => x.kind === "cancel")) {
    if (l.text.includes("一部だけ重なります")) assert.equal(l.defaultOn, false);
    else assert.equal(l.defaultOn, true);
  }
});

test("夜勤明け: 朝のリーダーには、前日の夜勤の業務のうちこれからのもの（朝食・申し送りなど）を時計の時刻で出す", async () => {
  const { overnightRows } = await import("../leader.ts");
  const s = state();
  // 11/4 の朝 7:00 に、11/3 の夜勤の業務が見える
  const rows = overnightRows(s, "2026-11-04", toMin(7));
  assert.ok(rows.length > 0);
  assert.ok(rows.some((r) => r.label.startsWith("申し送り")));
  for (const r of rows) {
    assert.ok(r.task.date === DATE);
    assert.ok(r.task.endMin > toMin(31));
    assert.doesNotMatch(r.timeText, /翌/);
  }
  // 9:30 には何も残らない（申し送りは 翌8:30–9:00）
  assert.equal(overnightRows(s, "2026-11-04", toMin(9, 30)).filter((r) => !r.isBreak).length, 0);
});
