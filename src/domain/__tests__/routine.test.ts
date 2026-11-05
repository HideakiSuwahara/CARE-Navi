import { test } from "node:test";
import assert from "node:assert/strict";

import { applyEvents } from "../reducer.ts";
import { applyPatternEvents, patternFromDay } from "../pattern.ts";
import { deterministicContext, seedToEvents } from "../loadSeed.ts";
import { tasksForDate } from "../checks.ts";
import { resetRowToStandard, routinesOf, sheetLines, splitRoutineTargets, withRow } from "../routine.ts";
import { toMin, fmtRange } from "../time.ts";
import { emptyState, type ResidentSheet, type SeedData, type State } from "../types.ts";
import { DATE, miniSeed } from "./fixture.ts";

/** ミニ施設の「見守り」と「口腔ケア」を日課にし、起床介助（7:00–8:00、東の全員）を足す */
function routineSeed(sheets: ResidentSheet[] = []): SeedData {
  const seed = miniSeed();
  seed.templates.push({
    id: "t-wake",
    name: "起床介助",
    kind: "care",
    categoryId: "core",
    targetMode: "group",
    defaultDurationMin: 60,
    defaultHeadcount: 1,
    requiredTags: [],
    procedure: [],
  });
  seed.patterns[0].items.push({
    id: "i-wake",
    templateId: "t-wake",
    startMin: toMin(7),
    endMin: toMin(8),
    groupId: "g-east",
    targetRule: "allInGroup",
    headcount: 1,
    slotIds: ["slot-a"],
    routineId: "rt-wake-east",
  });
  seed.sheets = sheets;
  return seed;
}

function stateOf(seed: SeedData): State {
  return applyEvents(emptyState(), seedToEvents(seed, deterministicContext("r")));
}

const wakeTasks = (s: State) => tasksForDate(s, DATE).filter((t) => t.routineId === "rt-wake-east");

test("全員が標準どおりなら、日課は一括の枠1枚", () => {
  const s = stateOf(routineSeed());
  const w = wakeTasks(s);
  assert.equal(w.length, 1);
  assert.deepEqual(s.targets[w[0].id], ["r-101", "r-102", "r-103"]);
  assert.equal(w[0].targetTimes, undefined);
});

test("枠の中に時刻を変えた方は一括のまま（時刻を残す）、枠の外の方は別の枠、なしの方は入らない", () => {
  const s = stateOf(
    routineSeed([
      { residentId: "r-101", rows: [{ id: "a", routineId: "rt-wake-east", startMin: toMin(7, 30) }] }, // 枠の中
      { residentId: "r-102", rows: [{ id: "b", routineId: "rt-wake-east", startMin: toMin(8, 30) }] }, // 枠の外
      { residentId: "r-103", rows: [{ id: "c", routineId: "rt-wake-east", skip: true }] }, // なし
    ]),
  );
  const w = wakeTasks(s).sort((a, b) => a.startMin - b.startMin);
  assert.equal(w.length, 2);
  assert.deepEqual(s.targets[w[0].id], ["r-101"]);
  assert.deepEqual(w[0].targetTimes, { "r-101": toMin(7, 30) });
  assert.equal(fmtRange(w[1].startMin, w[1].endMin), "8:30–9:30", "標準の長さ（1時間）を保つ");
  assert.deepEqual(s.targets[w[1].id], ["r-102"]);
  assert.equal(w[1].targetMode, "individual");
  // 二重に数えない: 3人のうち2人がどれか1枚に、なしの1人はどこにもいない
  const all = w.flatMap((t) => s.targets[t.id]);
  assert.deepEqual(all.sort(), ["r-101", "r-102"]);
  // 別の枠（8:30–9:30）: 同じ番（早番A）の佐藤は 9:00 から見守りに入っているので付けない → 担当未定
  const staffOf = (taskId: string) => Object.values(s.assignments).filter((a) => a.taskId === taskId).map((a) => a.staffId);
  assert.deepEqual(staffOf(w[1].id), []);
});

test("別の枠には、その時刻に勤務していて、ほかの担当と重ならない人を必要人数だけ付ける（番の全員は付けない）", () => {
  const s = stateOf(routineSeed([{ residentId: "r-102", rows: [{ id: "b", routineId: "rt-wake-east", startMin: toMin(8), endMin: toMin(8, 30) }] }]));
  const outside = wakeTasks(s).find((t) => t.startMin === toMin(8))!;
  const staff = Object.values(s.assignments).filter((a) => a.taskId === outside.id).map((a) => a.staffId);
  assert.deepEqual(staff, ["s-sato"], "8:00–8:30 は佐藤が空いている");
  assert.equal(outside.headcount, 1);
});

test("同じ時刻に枠の外へ変えた方は1枚にまとめる", () => {
  const s = stateOf(
    routineSeed([
      { residentId: "r-101", rows: [{ id: "a", routineId: "rt-wake-east", startMin: toMin(8, 30) }] },
      { residentId: "r-102", rows: [{ id: "b", routineId: "rt-wake-east", startMin: toMin(8, 30) }] },
    ]),
  );
  const outside = wakeTasks(s).filter((t) => t.startMin === toMin(8, 30));
  assert.equal(outside.length, 1);
  assert.equal(outside[0].targetMode, "group");
  assert.deepEqual(s.targets[outside[0].id].sort(), ["r-101", "r-102"]);
});

test("その方だけの行（業務の種類つき）は個別の枠になり、業務の種類なしの行は枠にならない", () => {
  const s = stateOf(
    routineSeed([
      {
        residentId: "r-103",
        rows: [
          { id: "x", templateId: "t-wake", startMin: toMin(14), label: "", support: "手すりで立ち上がり" },
          { id: "y", label: "新聞を読む", startMin: toMin(10) },
          { id: "z", templateId: "t-wake", startMin: toMin(15), weekdays: [0] }, // 日曜だけ（11/3 は火曜）
        ],
      },
    ]),
  );
  const extra = tasksForDate(s, DATE).filter((t) => t.startMin === toMin(14) && t.name === "起床介助");
  assert.equal(extra.length, 1);
  assert.deepEqual(s.targets[extra[0].id], ["r-103"]);
  assert.equal(tasksForDate(s, DATE).some((t) => t.name === "新聞を読む"), false);
  assert.equal(tasksForDate(s, DATE).some((t) => t.startMin === toMin(15)), false, "曜日が違えば作らない");
});

test("日課の一覧と24時間シートの行（調整を反映し時刻順）", () => {
  const s = stateOf(routineSeed([{ residentId: "r-102", rows: [{ id: "b", routineId: "rt-wake-east", startMin: toMin(8, 30), support: "声かけしてから" }] }]));
  const rs = routinesOf(s, "g-east");
  assert.ok(rs.some((r) => r.routineId === "rt-wake-east" && r.name === "起床介助"));
  const lines = sheetLines(s, "r-102");
  const wake = lines.find((l) => l.key === "rt-wake-east")!;
  assert.equal(wake.kind, "changed");
  assert.equal(fmtRange(wake.startMin, wake.endMin), "8:30–9:30");
  assert.equal(wake.row?.support, "声かけしてから");
  const std = sheetLines(s, "r-101").find((l) => l.key === "rt-wake-east")!;
  assert.equal(std.kind, "standard");
});

test("シートの行の差し替え・標準に戻す", () => {
  let sheet: ResidentSheet = { residentId: "r-101", rows: [] };
  sheet = withRow(sheet, { id: "1", routineId: "rt", startMin: 480, support: "見守り" });
  sheet = withRow(sheet, { id: "2", routineId: "rt", startMin: 500 }); // 同じ日課は1行だけ
  assert.equal(sheet.rows.length, 1);
  assert.equal(sheet.rows[0].startMin, 500);
  assert.equal(resetRowToStandard({ id: "1", routineId: "rt", startMin: 480 }), null, "文章がなければ行ごと消える");
  assert.equal(resetRowToStandard({ id: "1", routineId: "rt", startMin: 480, support: "見守り" })?.startMin, undefined);
});

test("splitRoutineTargets は日課でない項目ではそのまま全員", () => {
  const s = stateOf(routineSeed());
  const r = splitRoutineTargets(s, { id: "i", templateId: "t-wake", startMin: 0, endMin: 60, targetRule: "none", headcount: 1, slotIds: [] }, ["r-101"]);
  assert.deepEqual(r.main, ["r-101"]);
});

test("今日を業務表として保存しても、分かれた枠は残さない（次に作ったとき二重にならない）", () => {
  const s = stateOf(routineSeed([{ residentId: "r-102", rows: [{ id: "b", routineId: "rt-wake-east", startMin: toMin(8, 30) }] }]));
  const p = patternFromDay(s, DATE, "保存", deterministicContext("p"))!;
  assert.equal(p.items.filter((i) => i.routineId === "rt-wake-east").length, 1);
  const s2 = applyEvents(applyEvents(s, [{ eventId: "pu", ts: "t", batchId: "b", type: "pattern.upsert", pattern: p }]), applyPatternEvents(s, DATE, p.id, deterministicContext("q")));
  assert.equal(wakeTasks(s2).length, 2, "一括1枚と、田中…ではなく r-102 の別の枠1枚");
});

test("sheet.upsert は元に戻せる", async () => {
  const { invertEvent } = await import("../reducer.ts");
  const s0 = stateOf(routineSeed());
  const ev = { eventId: "e", ts: "t", batchId: "b", type: "sheet.upsert" as const, sheet: { residentId: "r-101", rows: [{ id: "a", routineId: "rt-wake-east", skip: true }] } };
  const s1 = applyEvents(s0, [ev]);
  assert.equal(s1.sheets["r-101"].rows.length, 1);
  const s2 = applyEvents(s1, invertEvent(ev, s0));
  assert.equal(s2.sheets["r-101"].rows.length, 0);
});

test("時間帯（朝 5:00–11:00・昼 11:00–17:00・夜 17:00–翌5:00）と、枠の中・外", async () => {
  const { bandOf, isWithinRoutine } = await import("../routine.ts");
  assert.equal(bandOf(toMin(5)), "morning");
  assert.equal(bandOf(toMin(10, 59)), "morning");
  assert.equal(bandOf(1440 + toMin(6)), "morning", "翌6:00 の起床も朝");
  assert.equal(bandOf(toMin(11)), "day");
  assert.equal(bandOf(toMin(16, 30)), "day");
  assert.equal(bandOf(toMin(17)), "night");
  assert.equal(bandOf(toMin(20)), "night");
  assert.equal(bandOf(1440 + toMin(4, 30)), "night", "翌4:30 は夜");
  const wake = { startMin: toMin(7), endMin: toMin(8) };
  assert.equal(isWithinRoutine(wake, toMin(7)), true);
  assert.equal(isWithinRoutine(wake, toMin(7, 30)), true);
  assert.equal(isWithinRoutine(wake, toMin(8)), false);
  assert.equal(isWithinRoutine(wake, toMin(6, 45)), false);
});

test("日課を足す・標準の時刻を変える・やめる（決定記録 0013）。すべて業務表に入り、時間割を作ると一括の枠になる", async () => {
  const { addRoutineEvents, retimeRoutineEvents, removeRoutineEvents } = await import("../routine.ts");
  const { invertBatch } = await import("../reducer.ts");
  const s0 = stateOf(routineSeed([{ residentId: "r-101", rows: [{ id: "a", routineId: "rt-wake-east", startMin: toMin(8, 30) }] }]));
  const before = routinesOf(s0, "g-east").length;

  // 13:30–14:00 のおむつ交換（ここでは起床介助の種類で代用）を足す
  const add = addRoutineEvents(s0, { templateId: "t-wake", groupId: "g-east", startMin: toMin(13, 30), endMin: toMin(14) }, deterministicContext("add", "t", "b-add"));
  assert.ok(add.length > 0 && add.every((e) => e.type === "pattern.upsert" && e.batchId === "b-add"), "業務表の書き換えだけ、1バッチ");
  const s1 = applyEvents(s0, add);
  const routines = routinesOf(s1, "g-east");
  assert.equal(routines.length, before + 1);
  const added = routines.find((r) => r.startMin === toMin(13, 30))!;
  assert.equal(added.name, "起床介助");
  const item = Object.values(s1.patterns)[0].items.find((it) => it.routineId === added.routineId)!;
  assert.equal(item.headcount, 1, "同じグループの同じ業務の日課（いちばん近い開始）の人数");
  const two = addRoutineEvents(s0, { templateId: "t-wake", groupId: "g-east", startMin: toMin(13, 30), endMin: toMin(14), headcount: 2 }, deterministicContext("h"));
  assert.equal(two[0].type === "pattern.upsert" ? two[0].pattern.items.at(-1)?.headcount : 0, 2, "人数を決めて足せる");
  assert.deepEqual(item.slotIds, ["slot-a"], "近い日課（7:00 の起床介助）の番で、13:30 に勤務している番（早番A 7:00–16:00）");
  const night = addRoutineEvents(s0, { templateId: "t-wake", groupId: "g-east", startMin: toMin(17), endMin: toMin(17, 30) }, deterministicContext("n"));
  const nightItem = night[0].type === "pattern.upsert" ? night[0].pattern.items.at(-1)! : null;
  assert.deepEqual(nightItem?.slotIds, ["slot-b"], "近い日課の番が勤務外なら、その時刻に勤務している番（日勤A 9:00–18:00）");

  // 時間割を作ると、東の全員の一括の枠が 1 枚
  const s2 = applyEvents(s1, applyPatternEvents(s1, DATE, "p-day", deterministicContext("ap")));
  const made = tasksForDate(s2, DATE).filter((t) => t.routineId === added.routineId);
  assert.equal(made.length, 1);
  assert.equal(fmtRange(made[0].startMin, made[0].endMin), "13:30–14:00");

  // 標準を 14:00–14:30 に変える
  const s3 = applyEvents(s1, retimeRoutineEvents(s1, added, toMin(14), toMin(14, 30), deterministicContext("rt"), 2));
  assert.equal(routinesOf(s3, "g-east").find((r) => r.routineId === added.routineId)?.startMin, toMin(14));
  const { routineHeadcount } = await import("../routine.ts");
  assert.equal(routineHeadcount(s3, added.routineId), 2);

  // 起床介助をやめると、業務表からも方ごとの調整からも消える。元に戻すと戻る
  const rm = removeRoutineEvents(s3, { routineId: "rt-wake-east", groupId: "g-east" }, deterministicContext("rm", "t", "b-rm"));
  let s4 = s3;
  const history = rm.map((event) => {
    const h = { event, before: s4 };
    s4 = applyEvents(s4, [event]);
    return h;
  });
  assert.equal(routinesOf(s4, "g-east").some((r) => r.routineId === "rt-wake-east"), false);
  assert.equal(s4.sheets["r-101"]?.rows.some((r) => r.routineId === "rt-wake-east") ?? false, false);
  const back = applyEvents(s4, invertBatch(history, "b-rm"));
  assert.equal(routinesOf(back, "g-east").some((r) => r.routineId === "rt-wake-east"), true);
  assert.equal(back.sheets["r-101"]?.rows[0]?.startMin, toMin(8, 30));
});

test("足した日課を、もうできている今日の時間割にも入れる（グリル U5）。2回目は何もしない", async () => {
  const { addRoutineEvents, addRoutineToDayEvents } = await import("../routine.ts");
  const s0 = stateOf(routineSeed([{ residentId: "r-102", rows: [{ id: "x", routineId: "rt-new", skip: true }] }]));
  const made = applyEvents(s0, applyPatternEvents(s0, DATE, "p-day", deterministicContext("ap")));
  const add = addRoutineEvents(made, { templateId: "t-wake", groupId: "g-east", startMin: toMin(13, 30), endMin: toMin(14) }, deterministicContext("add"));
  const s1 = applyEvents(made, add);
  const rt = routinesOf(s1, "g-east").find((r) => r.startMin === toMin(13, 30))!;
  const today = addRoutineToDayEvents(s1, DATE, rt.routineId, "g-east", deterministicContext("today"));
  const s2 = applyEvents(s1, today);
  const t = tasksForDate(s2, DATE).find((x) => x.routineId === rt.routineId);
  assert.ok(t, "今日の時間割に枠ができる");
  assert.equal(fmtRange(t!.startMin, t!.endMin), "13:30–14:00");
  assert.ok((s2.targets[t!.id] ?? []).length > 0, "グループの方が対象");
  assert.ok(Object.values(s2.assignments).some((a) => a.taskId === t!.id), "番のその日の出勤者が担当");
  assert.equal(addRoutineToDayEvents(s2, DATE, rt.routineId, "g-east", deterministicContext("again")).length, 0);
  assert.equal(addRoutineToDayEvents(s1, "2026-11-20", rt.routineId, "g-east", deterministicContext("empty")).length, 0, "時間割のない日は何もしない");
});
