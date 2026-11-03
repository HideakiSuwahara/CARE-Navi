import { test } from "node:test";
import assert from "node:assert/strict";

import { himawariSeed } from "../seed/index.ts";
import { deterministicContext, stateFromSeed } from "../loadSeed.ts";
import { businessMinutes, leaderContact, leaderSchedule, myDay, targetLines, viewerMinutes } from "../myday.ts";
import { tasksForDate } from "../checks.ts";
import { toMin } from "../time.ts";

const DATE = "2026-11-03";
const state = () => stateFromSeed(himawariSeed, deterministicContext("h"));

test("時計の 6:00 より前は、業務日の翌0:00〜として読む", () => {
  assert.equal(businessMinutes(toMin(2)), toMin(26));
  assert.equal(businessMinutes(toMin(10, 12)), toMin(10, 12));
});

test("困ったら: 日中は早番A（佐藤）、夕方は遅番（木村）、夜は夜勤東（斉藤）", () => {
  const s = state();
  assert.equal(leaderContact(s, DATE, toMin(10))?.leader.surname, "佐藤");
  assert.equal(leaderContact(s, DATE, toMin(10))?.leader.phone, "801");
  assert.equal(leaderContact(s, DATE, toMin(17, 30))?.leader.surname, "木村");
  assert.equal(leaderContact(s, DATE, toMin(23))?.leader.surname, "斉藤");
});

test("困ったら: リーダーが休憩中なら、休憩の時刻と代わりの人", () => {
  const s = state();
  const brk = tasksForDate(s, DATE).find((t) => t.kind === "break" && Object.values(s.assignments).some((a) => a.taskId === t.id && a.staffId === "stf-sato"));
  assert.ok(brk, "佐藤さんの休憩がある");
  const c = leaderContact(s, DATE, brk!.startMin + 5);
  assert.equal(c?.leader.surname, "佐藤");
  assert.deepEqual(c?.onBreak, { startMin: brk!.startMin, endMin: brk!.endMin });
  assert.ok(c?.substitute, "代わりの人がいる");
  assert.notEqual(c?.substitute?.surname, "佐藤");
});

test("自分の予定: いまの時間の予定と、つぎ", () => {
  const s = state();
  const d = myDay(s, DATE, "stf-sato", toMin(10, 12))!;
  assert.equal(d.focusMode, "now");
  assert.ok(d.focus.length >= 1);
  assert.ok(d.focus.every((i) => i.task.startMin <= toMin(10, 12) && toMin(10, 12) < i.task.endMin));
  assert.ok(d.upcoming && d.upcoming.task.startMin > toMin(10, 12));
  // 過ぎた予定は「過ぎた」だけ（完了の印ではない）
  assert.ok(d.items.some((i) => i.past));
});

test("自分の予定: 勤務前の初回の方（加藤 12:50）は「最初の予定」と「つぎ」", () => {
  const s = state();
  const d = myDay(s, DATE, "stf-kato", toMin(12, 50))!;
  assert.equal(d.entry.firstTimer, true);
  assert.equal(d.focusMode, "first");
  assert.equal(d.focus[0].task.name, "到着・案内");
  assert.ok(d.upcoming);
});

test("自分の予定: 利用者の名前は設定に従う（既定: 部屋番号＋姓）。仕組みの言葉を出さない", () => {
  const s = state();
  for (const id of Object.keys(s.staff)) {
    const d = myDay(s, DATE, id, toMin(10));
    if (!d) continue;
    for (const i of d.items) {
      assert.doesNotMatch(`${i.title} ${i.target}`, /一括|共通|コア|ノンコア|役割枠|担当未定|担当あと/);
      if (i.task.targetMode === "individual") assert.match(i.title, /\d+ \S+様$/);
    }
  }
});

test("業務詳細の対象の方: サポートの1行は、担当の人に勤務時間中だけ。6人まで出して残りは「ほか n 人」", () => {
  const s = state();
  const task = tasksForDate(s, DATE).find(
    (t) => t.routineId && (s.targets[t.id] ?? []).some((rid) => s.sheets[rid]?.rows.some((r) => r.routineId === t.routineId && r.support)),
  )!;
  assert.ok(task, "サポートの書いてある日課の枠がある");
  const assignee = Object.values(s.assignments).find((a) => a.taskId === task.id)!.staffId;
  const entry = Object.values(s.roster).find((e) => e.date === DATE && e.staffId === assignee)!;
  const inShift = targetLines(s, task, assignee, entry.startMin + 1);
  assert.equal(inShift.supportShown, true);
  assert.ok(inShift.lines.some((l) => l.support));
  assert.ok(inShift.lines.length <= 6);
  assert.equal(inShift.lines.length + inShift.more, (s.targets[task.id] ?? []).length);
  const offShift = targetLines(s, task, assignee, entry.endMin + 1);
  assert.equal(offShift.supportShown, false);
  const notAssignee = Object.keys(s.staff).find((id) => !Object.values(s.assignments).some((a) => a.taskId === task.id && a.staffId === id))!;
  assert.equal(targetLines(s, task, notAssignee, entry.startMin + 1).supportShown, false);
});

test("困ったら: リーダーの番が決まっていない施設では、番の並び順で見る", () => {
  // 状態はシードのオブジェクトを共有しているので、複製してから変える
  const s = structuredClone(state());
  for (const slot of Object.values(s.roleSlots)) delete slot.leaderRank;
  const c = leaderContact(s, DATE, toMin(10));
  assert.equal(c?.leader.surname, "佐藤");
  assert.equal(c?.isLeader, false, "リーダーの番が決まっていないので「リーダー」とは書かない");
  assert.equal(c?.slotName, "早番A");
});

test("困ったら: 夜勤のリーダーが休憩中なら、もう一人の夜勤者が代わり（近くの職員へ、にしない）", () => {
  const s = state();
  const brk = tasksForDate(s, DATE).find((t) => t.kind === "break" && t.startMin >= toMin(24) && Object.values(s.assignments).some((a) => a.taskId === t.id && a.staffId === "stf-saito"));
  assert.ok(brk, "斉藤さんの夜の休憩がある");
  const c = leaderContact(s, DATE, brk!.startMin + 5);
  assert.equal(c?.leader.surname, "斉藤");
  assert.ok(c?.onBreak);
  assert.equal(c?.substitute?.surname, "野口");
});

test("困ったら: 勤務中の人がいない時刻は undefined（画面は「近くの職員へ」）。まだ来ていない人を出さない", () => {
  const s = state();
  assert.equal(leaderContact(s, DATE, toMin(6, 30)), undefined);
});

test("夜勤の人は、勤務前の朝の時刻を「翌」として読む（夜勤明けの予定が出る）", () => {
  const s = state();
  assert.equal(viewerMinutes(s, DATE, "stf-saito", toMin(6, 30)), toMin(30, 30));
  assert.equal(viewerMinutes(s, DATE, "stf-sato", toMin(6, 30)), toMin(6, 30));
  assert.equal(viewerMinutes(s, DATE, "stf-saito", toMin(30, 30)), toMin(30, 30));
  const d = myDay(s, DATE, "stf-saito", viewerMinutes(s, DATE, "stf-saito", toMin(6, 30)))!;
  assert.equal(d.focusMode, "now");
});

test("印刷用の相談先の移り変わり: 早番A → 遅番 → 夜勤東", () => {
  const s = state();
  const sched = leaderSchedule(s, DATE, toMin(7), toMin(30));
  const names = sched.map((x) => x.contact.leader.surname);
  assert.deepEqual([...new Set(names)], ["佐藤", "木村", "斉藤"]);
  for (let i = 1; i < sched.length; i++) assert.equal(sched[i - 1].endMin <= sched[i].startMin, true);
});

test("困ったら: リーダー本人には、次の相談先（勤務中で次に順の人）を出す", () => {
  const s = state();
  const c = leaderContact(s, DATE, toMin(10))!;
  assert.equal(c.leader.surname, "佐藤");
  assert.ok(c.next, "次の人がいる");
  assert.notEqual(c.next?.surname, "佐藤");
});
