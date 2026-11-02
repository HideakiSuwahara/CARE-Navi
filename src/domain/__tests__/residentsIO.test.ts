import { test } from "node:test";
import assert from "node:assert/strict";

import { applyEvents } from "../reducer.ts";
import { deterministicContext, seedToEvents } from "../loadSeed.ts";
import { parseResidentPaste, residentsOfGroup, routineGridCsvRows, sheetCsvRows, toCsv } from "../residentsIO.ts";
import { toMin } from "../time.ts";
import { emptyState, type State } from "../types.ts";
import { miniSeed } from "./fixture.ts";

function stateWithWake(): State {
  const seed = miniSeed();
  seed.templates.push({
    id: "t-wake",
    name: "起床介助",
    kind: "care",
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
    routineId: "rt-wake",
  });
  seed.sheets = [
    { residentId: "r-101", rows: [{ id: "a", routineId: "rt-wake", startMin: toMin(8, 30), support: "声かけ、ゆっくり" }] },
    { residentId: "r-102", rows: [{ id: "b", routineId: "rt-wake", skip: true }] },
  ];
  return applyEvents(emptyState(), seedToEvents(seed, deterministicContext("io")));
}

test("名簿の貼り付け: カンマ・タブ・全角カンマを読み、姓は空白の前。失敗行は行番号と理由", () => {
  const s = stateWithWake();
  const r = parseResidentPaste(s, "木村 ハル, 東フロア, 110\n\n森　ツル\t東フロア\t111\n石井 ミツ，西フロア，112\n , 東フロア, 113\n");
  assert.deepEqual(
    r.residents.map((x) => [x.line, x.displayName, x.surname, x.groupId, x.room]),
    [
      [1, "木村 ハル", "木村", "g-east", "110"],
      [3, "森 ツル", "森", "g-east", "111"],
    ],
  );
  assert.deepEqual(r.errors.map((e) => e.line), [4, 5]);
  assert.match(r.errors[0].reason, /西フロア/);
});

test("一覧の CSV: 標準どおりは空欄、変更は時刻、なしは「なし」", () => {
  const rows = routineGridCsvRows(stateWithWake(), "g-east");
  assert.equal(rows[0][2], "起床介助（標準 7:00）");
  assert.deepEqual(rows.slice(1).map((r) => r[2]), ["8:30", "なし", ""]);
});

test("24時間シートの CSV: 利用者名と、時刻・状態・4項目。BOM と引用符", () => {
  const s = stateWithWake();
  const rows = sheetCsvRows(s, "r-101");
  assert.equal(rows[0][1], "山田 キヨ様");
  const wake = rows.find((r) => r[1] === "起床介助");
  assert.deepEqual(wake, ["8:30", "起床介助", "変更", "", "", "", "声かけ、ゆっくり"]);
  const csv = toCsv([["a,b", 'c"d']]);
  assert.equal(csv, '﻿"a,b","c""d"\r\n');
});

test("グループの利用者は部屋番号順", () => {
  assert.deepEqual(residentsOfGroup(stateWithWake(), "g-east").map((r) => r.room), ["101", "102", "103"]);
});

test("マスを直すイベント: まとめて時刻・なし・標準に戻す。標準の時刻を入れたら標準に戻す", async () => {
  const { routineChangeEvents, sheetTextEvent } = await import("../residentsIO.ts");
  const { routinesOf, sheetRowFor, sheetLines } = await import("../routine.ts");
  let s = stateWithWake();
  const rt = routinesOf(s, "g-east")[0];
  const ctx = deterministicContext("c");
  const ev = routineChangeEvents(s, ctx, ["r-102", "r-103"], rt, { kind: "time", startMin: toMin(9) });
  assert.equal(ev.length, 2);
  assert.ok(ev.every((e) => e.batchId === ctx.batchId));
  s = applyEvents(s, ev);
  assert.equal(sheetRowFor(s, "r-102", "rt-wake")?.startMin, toMin(9));
  assert.equal(sheetRowFor(s, "r-102", "rt-wake")?.skip, undefined);
  s = applyEvents(s, routineChangeEvents(s, ctx, ["r-103"], rt, { kind: "time", startMin: toMin(7) }));
  assert.equal(sheetRowFor(s, "r-103", "rt-wake"), undefined, "標準の時刻は標準に戻す");
  // 文章のある行は、標準に戻しても文章を残す
  s = applyEvents(s, routineChangeEvents(s, ctx, ["r-101"], rt, { kind: "reset" }));
  assert.equal(sheetRowFor(s, "r-101", "rt-wake")?.support, "声かけ、ゆっくり");
  assert.equal(sheetRowFor(s, "r-101", "rt-wake")?.startMin, undefined);
  // 文章を書く（行がなければ作る）。同じ文なら何もしない
  const line = sheetLines(s, "r-103").find((l) => l.key === "rt-wake")!;
  const t = sheetTextEvent(s, ctx, "r-103", line, "preference", "ゆっくり起きたい");
  assert.ok(t);
  s = applyEvents(s, [t]);
  assert.equal(sheetRowFor(s, "r-103", "rt-wake")?.preference, "ゆっくり起きたい");
  const line2 = sheetLines(s, "r-103").find((l) => l.key === "rt-wake")!;
  assert.equal(sheetTextEvent(s, ctx, "r-103", line2, "preference", "ゆっくり起きたい "), null);
});
