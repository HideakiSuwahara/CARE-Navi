import { test } from "node:test";
import assert from "node:assert/strict";

import { fmtDuration, fmtMin, fmtRange, overlaps, parseTime, toMin } from "../time.ts";
import {
  checkAssignment,
  headcountLabel,
  headcountStatus,
  rankCandidates,
  shortageSummary,
  splitCandidates,
  tasksForDate,
} from "../checks.ts";
import { applyEvents, invertBatch } from "../reducer.ts";
import { applyPatternEvents, createDayEvents, morningDraft, patternFromDay, reassignSlotEvents } from "../pattern.ts";
import { absencePreview, assignEvents, defaultEscortRange, defaultUnchecked, escortPreview, selectPreview, shiftTaskEvents } from "../commands.ts";
import { residentLabel, targetChip } from "../display.ts";
import { deterministicContext } from "../loadSeed.ts";
import type { Event } from "../events.ts";
import type { State } from "../types.ts";
import { DATE, findTask, miniState } from "./fixture.ts";

// ---------------------------------------------------------------------------
// 時刻
// ---------------------------------------------------------------------------

test("fmtMin: 業務日内と翌日", () => {
  assert.equal(fmtMin(toMin(10)), "10:00");
  assert.equal(fmtMin(toMin(9, 5)), "9:05");
  assert.equal(fmtMin(1560), "翌2:00");
  assert.equal(fmtRange(toMin(10, 30), toMin(12)), "10:30–12:00");
  assert.equal(fmtDuration(90), "1時間30分");
  assert.equal(fmtDuration(30), "30分");
  assert.equal(fmtDuration(120), "2時間");
});

test("parseTime", () => {
  assert.equal(parseTime("9:30"), 570);
  assert.equal(parseTime("09:30"), 570);
  assert.equal(parseTime("翌2:00"), 1560);
  assert.equal(parseTime("25:00"), null);
  assert.equal(parseTime("abc"), null);
});

test("overlaps は半開区間", () => {
  assert.equal(overlaps(600, 630, 630, 660), false); // 10:00–10:30 と 10:30–11:00 は重ならない
  assert.equal(overlaps(600, 660, 630, 700), true);
});

// ---------------------------------------------------------------------------
// 充足バッジの文言
// ---------------------------------------------------------------------------

test("充足バッジは「担当未定」「担当あと n 人」「OK」「n人 多め」だけを使う", () => {
  assert.equal(headcountLabel(3, 0), "担当未定");
  assert.equal(headcountLabel(3, 2), "担当あと1人");
  assert.equal(headcountLabel(5, 2), "担当あと3人");
  assert.equal(headcountLabel(3, 3), "OK");
  assert.equal(headcountLabel(2, 3), "1人 多め");
  assert.equal(headcountLabel(0, 0), "");
  for (const [r, a] of [
    [3, 0],
    [3, 2],
    [3, 3],
    [2, 3],
  ]) {
    assert.ok(!headcountLabel(r, a).includes("不足"), "「不足」という語を使わない");
  }
});

// ---------------------------------------------------------------------------
// 型を当てる（役割枠 → 担当）
// ---------------------------------------------------------------------------

test("型を当てると、役割枠の出勤者が担当になる。休みの役割の枠は担当未定になる", () => {
  const s = miniState();
  const tasks = tasksForDate(s, DATE);
  assert.equal(tasks.length, 5);

  const watch = findTask(s, "見守り");
  assert.deepEqual(headcountStatus(s, watch.id), { required: 1, assigned: 1, gap: 0, level: "ok", label: "OK" });

  const bath = findTask(s, "入浴介助");
  const hs = headcountStatus(s, bath.id);
  assert.equal(hs.assigned, 2, "早番A と 日勤A が入る。介護助手は休み");
  assert.equal(hs.label, "担当あと1人");
  assert.deepEqual(s.targets[bath.id], ["r-101", "r-102"], "対象者は明示保存される");

  const linen = findTask(s, "リネン回収");
  assert.equal(headcountStatus(s, linen.id).label, "担当未定");

  // 担当あと n 人: 入浴（3→2）、口腔ケア（2→1）。休憩はバッジの対象外（決定記録 0003 §5）
  assert.deepEqual(shortageSummary(s, DATE), { unassigned: 1, short: 2 });
  assert.equal(headcountStatus(s, findTask(s, "休憩①").id).label, "", "休憩にはバッジを付けない");
  assert.equal(s.days[DATE]?.appliedPatternId, "p-day");
});

test("allInGroup はグループの全員を対象にする（人数だけでなく誰か）", () => {
  const s = miniState();
  const watch = findTask(s, "見守り");
  assert.deepEqual(s.targets[watch.id], ["r-101", "r-102", "r-103"]);
  assert.equal(targetChip(s, watch), "一括 3人");
});

test("型を当て直しても、手で足した予定は残る", () => {
  let s = miniState();
  const ctx = deterministicContext("m");
  const manual: Event = {
    eventId: "m-task",
    ts: ctx.ts,
    batchId: "b1",
    type: "task.add",
    task: {
      id: "task-manual",
      date: DATE,
      name: "面会対応",
      kind: "care",
      targetMode: "individual",
      startMin: toMin(14),
      endMin: toMin(14, 30),
      headcount: 1,
      requiredTags: [],
      slotIds: [],
      status: "planned",
      origin: "manual",
    },
    residentIds: ["r-102"],
  };
  s = applyEvents(s, [manual]);
  assert.equal(tasksForDate(s, DATE).length, 6);
  s = applyEvents(s, applyPatternEvents(s, DATE, "p-day", { ...ctx, batchId: "b2" }));
  const names = tasksForDate(s, DATE).map((t) => t.name);
  assert.equal(names.length, 6, "型の5件は作り直され、手で足した1件は残る");
  assert.ok(names.includes("面会対応"));
});

// ---------------------------------------------------------------------------
// 配置チェック
// ---------------------------------------------------------------------------

test("二重登録は常に禁止", () => {
  const s = miniState();
  const bath = findTask(s, "入浴介助");
  const issues = checkAssignment(s, bath.id, "s-sato");
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, "duplicate");
  assert.equal(issues[0].severity, "block");
});

test("勤務外・欠勤・条件不一致・重なり・休憩は理由つきで警告（禁止しない）", () => {
  const s = miniState();
  const bath = findTask(s, "入浴介助"); // 10:30–12:00 条件: 入浴担当可

  // 加藤: 勤務 13:00–17:00 → 勤務外、条件なし → missingTags
  const kato = checkAssignment(s, bath.id, "s-kato");
  assert.deepEqual(
    kato.map((i) => i.code),
    ["offShift", "missingTags"],
  );
  assert.ok(kato.every((i) => i.severity === "warn"));
  assert.match(kato[0].message, /勤務予定がありません|勤務前/);

  // 渡辺: 欠勤
  const watanabe = checkAssignment(s, bath.id, "s-watanabe");
  assert.equal(watanabe[0].code, "absent");

  // 鈴木を見守り(9–11)へ: 入浴(10:30–12:00)と重なる → overlap。休憩①(11–12)は 9–11 と重ならない
  const watch = findTask(s, "見守り");
  const suzuki = checkAssignment(s, watch.id, "s-suzuki");
  assert.deepEqual(
    suzuki.map((i) => i.code),
    ["overlap"],
  );
  assert.match(suzuki[0].message, /10:30–12:00 の「入浴介助（東フロア）」と重なります/);

  // 鈴木をリネン回収(10:30–11:00)へ: 入浴と重なる（休憩①は 11:00 から）
  const linen = findTask(s, "リネン回収");
  const suzuki2 = checkAssignment(s, linen.id, "s-suzuki");
  assert.deepEqual(
    suzuki2.map((i) => i.code),
    ["overlap"],
  );
});

test("休憩と重なると onBreak", () => {
  let s = miniState();
  // 鈴木は休憩① 11:00–12:00 に入っている。11:30–12:30 の業務を足して鈴木を候補にする
  const ev: Event = {
    eventId: "x1",
    ts: "2026-11-03T10:00:00+09:00",
    batchId: "x",
    type: "task.add",
    task: {
      id: "task-x",
      date: DATE,
      name: "食堂準備",
      kind: "care",
      categoryId: "noncore",
      targetMode: "none",
      startMin: toMin(11, 30),
      endMin: toMin(12, 30),
      headcount: 1,
      requiredTags: [],
      slotIds: [],
      status: "planned",
    },
    residentIds: [],
  };
  s = applyEvents(s, [ev]);
  const issues = checkAssignment(s, "task-x", "s-suzuki");
  const codes = issues.map((i) => i.code);
  assert.ok(codes.includes("onBreak"));
  assert.ok(codes.includes("overlap"), "入浴 10:30–12:00 とも重なる");
});

test("初回の方だけの配置は警告（施設設定でON）", () => {
  const s = miniState();
  const oral = findTask(s, "口腔ケア"); // スポット(午後)=加藤(初回) が1人入っている。必要2
  // 加藤はすでに担当 → 別の初回の人を足す状況を作る: 佐藤を初回にする
  const s2: State = {
    ...s,
    roster: { ...s.roster, "ro-sato": { ...s.roster["ro-sato"], firstTimer: true } },
  };
  const issues = checkAssignment(s2, oral.id, "s-sato");
  assert.ok(issues.some((i) => i.code === "firstTimerOnly"));
  // 初回でない鈴木なら警告しない（13:00–13:30 は鈴木の他の担当と重ならない）
  const ok = checkAssignment(s, oral.id, "s-suzuki");
  assert.ok(!ok.some((i) => i.code === "firstTimerOnly"));
});

test("候補一覧: 問題なし → 注意 → 勤務外 の順。すでに担当の人は出ない", () => {
  const s = miniState();
  const bath = findTask(s, "入浴介助");
  const cands = rankCandidates(s, bath.id);
  const ids = cands.map((c) => c.staff.id);
  assert.ok(!ids.includes("s-sato") && !ids.includes("s-suzuki"), "担当済みは除く");
  const tiers = cands.map((c) => c.tier);
  const order = { ok: 0, partial: 1, warn: 2, off: 3, blocked: 4 } as const;
  for (let i = 1; i < tiers.length; i++) {
    assert.ok(order[tiers[i - 1]] <= order[tiers[i]]);
  }
  assert.equal(cands.find((c) => c.staff.id === "s-watanabe")?.tier, "off");
});

test("候補は「問題なし」を開いて出し、他は畳む（注意・勤務外の件数つき）", () => {
  const s = miniState();
  const linen = findTask(s, "リネン回収"); // 10:30–11:00 共通、担当未定
  const { open, folded, warnCount, offCount } = splitCandidates(rankCandidates(s, linen.id));
  assert.equal(open.length, 0, "佐藤・鈴木は入浴と重なる");
  assert.equal(warnCount, 2);
  assert.equal(offCount, 2, "加藤は勤務前、渡辺は休み");
  assert.equal(folded.length, 4);
});

// ---------------------------------------------------------------------------
// 元に戻す
// ---------------------------------------------------------------------------

test("割当 → まとめて戻す で元の状態に戻る", () => {
  const s0 = miniState();
  const ctx = deterministicContext("u", "2026-11-03T10:12:00+09:00", "batch-assign");
  const bath = findTask(s0, "入浴介助");
  const evs = assignEvents(bath.id, "s-kato", ctx);
  const history = evs.map((event, i) => ({ event, before: applyEvents(s0, evs.slice(0, i)) }));
  const s1 = applyEvents(s0, evs);
  assert.equal(headcountStatus(s1, bath.id).label, "OK");

  const undo = invertBatch(history, "batch-assign");
  const s2 = applyEvents(s1, undo);
  assert.equal(headcountStatus(s2, bath.id).label, "担当あと1人");
  assert.deepEqual(Object.keys(s2.assignments).sort(), Object.keys(s0.assignments).sort());
});

test("ずらす は長さを保つ", () => {
  const s = miniState();
  const linen = findTask(s, "リネン回収");
  const s2 = applyEvents(s, shiftTaskEvents(s, linen.id, 30, deterministicContext("sh")));
  const t = s2.tasks[linen.id];
  assert.equal(fmtRange(t.startMin, t.endMin), "11:00–11:30");
});

// ---------------------------------------------------------------------------
// クイック操作
// ---------------------------------------------------------------------------

test("付き添い: 重なる業務からは外し、休憩は外さず後ろへずらす", () => {
  const s = miniState();
  const ctx = deterministicContext("e", "2026-11-03T10:12:00+09:00", "batch-escort");
  const preview = escortPreview(
    s,
    { date: DATE, residentId: "r-101", startMin: toMin(10, 30), endMin: toMin(12), staffId: "s-suzuki" },
    ctx,
  );
  const kinds = preview.lines.map((l) => l.kind);
  assert.equal(kinds[0], "add");
  assert.match(preview.lines[0].text, /受診の付き添い 山田様 10:30–12:00 → 担当 鈴木/, "既定の業務名は受診の付き添い");
  assert.equal(preview.lines.filter((l) => l.kind === "unassign").length, 1, "入浴から外す");
  const move = preview.lines.find((l) => l.kind === "move");
  assert.ok(move, "休憩はずらす");
  assert.match(move!.text, /鈴木 の休憩 11:00–12:00 → 12:00–13:00/);
  assert.ok(preview.lines.some((l) => l.kind === "effect" && l.text.includes("入浴介助")), "入浴が担当あと2人になる");

  const s2 = applyEvents(s, preview.events);
  assert.equal(headcountStatus(s2, findTask(s2, "入浴介助").id).label, "担当あと2人");
  const own = Object.values(s2.tasks).find((t) => t.name === "休憩（鈴木）");
  assert.ok(own && own.kind === "break" && fmtRange(own.startMin, own.endMin) === "12:00–13:00");
  const escort = Object.values(s2.tasks).find((t) => t.name === "受診の付き添い")!;
  assert.deepEqual(s2.targets[escort.id], ["r-101"]);
  assert.equal(checkAssignment(s2, findTask(s2, "見守り").id, "s-suzuki").some((i) => i.code === "onBreak"), false);
});

test("付き添い: 担当を選ばなければ担当未定で作る。同じ利用者の同じ時間の個別業務は中止の候補（最初はチェックなし）", () => {
  let s = miniState();
  const bathOne: Event = {
    eventId: "b1",
    ts: "2026-11-03T08:00:00+09:00",
    batchId: "b",
    type: "task.add",
    task: {
      id: "task-bath-yamada",
      date: DATE,
      name: "入浴介助",
      kind: "care",
      targetMode: "individual",
      startMin: toMin(11),
      endMin: toMin(11, 30),
      headcount: 1,
      requiredTags: [],
      slotIds: [],
      status: "planned",
    },
    residentIds: ["r-101"],
  };
  s = applyEvents(s, [bathOne]);
  const { startMin, endMin } = defaultEscortRange(toMin(10, 12));
  assert.equal(fmtRange(startMin, endMin), "10:15–11:45");
  const preview = escortPreview(s, { date: DATE, residentId: "r-101", startMin, endMin }, deterministicContext("e2"));
  assert.ok(preview.lines.some((l) => l.kind === "effect" && l.text.includes("担当未定")));
  const cancel = preview.lines.find((l) => l.kind === "cancel")!;
  assert.equal(cancel.defaultOn, false);
  const s2 = applyEvents(s, selectPreview(preview, defaultUnchecked(preview)));
  assert.equal(s2.tasks["task-bath-yamada"].status, "planned", "既定では中止しない");
  const s3 = applyEvents(s, preview.events);
  assert.equal(s3.tasks["task-bath-yamada"].status, "cancelled");
});

test("欠勤: 本日の担当をすべて外し、空く枠を示す", () => {
  const s = miniState();
  const preview = absencePreview(s, DATE, "s-sato", deterministicContext("a", "2026-11-03T08:00:00+09:00", "batch-abs"));
  assert.equal(preview.lines[0].kind, "move");
  const unassign = preview.lines.filter((l) => l.kind === "unassign");
  assert.equal(unassign.length, 2, "見守りと入浴");
  const s2 = applyEvents(s, preview.events);
  assert.equal(headcountStatus(s2, findTask(s2, "見守り").id).label, "担当未定");
  assert.equal(s2.roster["ro-sato"].absent, true);
  // 欠勤にした人は候補で「欠勤」と出る
  const issues = checkAssignment(s2, findTask(s2, "見守り").id, "s-sato");
  assert.equal(issues[0].code, "absent");
});

test("早退: 勤務中なら今の時刻（15分切り上げ）で早退にし、それ以降の担当だけ外す", () => {
  const s = miniState();
  const preview = absencePreview(s, DATE, "s-sato", deterministicContext("l"), toMin(10, 5));
  assert.equal(preview.title, "早退");
  assert.match(preview.lines[0].text, /7:00–10:15 にする（早退）/);
  const s2 = applyEvents(s, preview.events);
  assert.equal(s2.roster["ro-sato"].endMin, toMin(10, 15));
  assert.equal(s2.roster["ro-sato"].absent, false);
});

test("朝: 先週の同じ曜日の番を写し、曜日の業務表を選び、1バッチで作る", () => {
  const base = miniState();
  // 今日の時間割と出勤者を消し、先週（10/27）の出勤者だけがある状態にする
  const lastWeek = "2026-10-27";
  const roster = Object.fromEntries(
    Object.values(base.roster).map((e) => [`lw-${e.id}`, { ...e, id: `lw-${e.id}`, date: lastWeek, firstTimer: true, absent: e.staffId === "s-watanabe" }]),
  );
  const s: State = { ...base, tasks: {}, targets: {}, assignments: {}, days: {}, roster, patterns: { "p-day": { ...base.patterns["p-day"], weekdays: [2] } } };
  let n = 0;
  const draft = morningDraft(s, DATE, () => `new-${++n}`);
  assert.equal(draft.source, "lastWeek");
  assert.equal(draft.patternId, "p-day", "火曜の業務表");
  assert.equal(draft.entries.length, 4);
  assert.ok(draft.entries.every((e) => e.date === DATE && !e.firstTimer && !e.absent), "初回・休みは引き継がない");

  const ctx = deterministicContext("m", "2026-11-03T07:00:00+09:00", "batch-morning");
  const evs = createDayEvents(s, draft, ctx);
  assert.ok(evs.every((e) => e.batchId === "batch-morning"), "1回で元に戻せる");
  const s2 = applyEvents(s, evs);
  assert.equal(tasksForDate(s2, DATE).length, 5);
  assert.equal(headcountStatus(s2, findTask(s2, "リネン回収").id).label, "OK", "渡辺も出勤なので介護助手の枠が埋まる");
});

// ---------------------------------------------------------------------------
// 役割の持ち替え・型として保存
// ---------------------------------------------------------------------------

test("役割枠の持ち替えで、その役割の業務の担当が付け替わる", () => {
  const s = miniState();
  const ctx = deterministicContext("r");
  const evs = reassignSlotEvents(s, DATE, "slot-a", "s-sato", "s-kato", ctx);
  const s2 = applyEvents(s, evs);
  const watch = findTask(s2, "見守り");
  const bath = findTask(s2, "入浴介助");
  const names = (id: string) =>
    Object.values(s2.assignments)
      .filter((a) => a.taskId === id)
      .map((a) => a.staffId)
      .sort();
  assert.deepEqual(names(watch.id), ["s-kato"]);
  assert.deepEqual(names(bath.id), ["s-kato", "s-suzuki"]);
});

test("今日を型として保存: 人は保存せず、対象の決め方を復元する", () => {
  const s = miniState();
  const p = patternFromDay(s, DATE, "火曜の形", deterministicContext("p"));
  assert.ok(p);
  assert.equal(p!.items.length, 5);
  const watch = p!.items.find((i) => i.templateId === "t-watch")!;
  assert.equal(watch.targetRule, "allInGroup");
  const bath = p!.items.find((i) => i.templateId === "t-bath")!;
  assert.equal(bath.targetRule, "residents");
  assert.deepEqual(bath.residentIds, ["r-101", "r-102"]);
  assert.deepEqual(bath.slotIds, ["slot-a", "slot-b", "slot-helper"]);
});

// ---------------------------------------------------------------------------
// 表示名
// ---------------------------------------------------------------------------

test("手元画面の利用者表示名は施設設定で選べる", () => {
  const r = { id: "r", displayName: "田中 ハナ", surname: "田中", groupId: "g", room: "203" };
  assert.equal(residentLabel(r, "full"), "田中 ハナ");
  assert.equal(residentLabel(r, "roomAndSurname"), "203 田中");
  assert.equal(residentLabel(r, "roomOnly"), "203");
});
