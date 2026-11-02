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
  // 別の枠も同じ番の人が担当（早番A=佐藤）
  const staffOf = (taskId: string) => Object.values(s.assignments).filter((a) => a.taskId === taskId).map((a) => a.staffId);
  assert.deepEqual(staffOf(w[1].id), ["s-sato"]);
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
