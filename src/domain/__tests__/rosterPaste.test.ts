import { test } from "node:test";
import assert from "node:assert/strict";

import { himawariSeed } from "../seed/index.ts";
import { deterministicContext, stateFromSeed } from "../loadSeed.ts";
import { applyEvents, invertBatch } from "../reducer.ts";
import { matchSlot, parseDateCell, parseRosterPaste, rosterPasteEvents, rosterPasteLabel } from "../rosterPaste.ts";
import { morningDraft } from "../pattern.ts";
import { rosterForDate } from "../checks.ts";

const state = () => stateFromSeed(himawariSeed, deterministicContext("r"));
const ctx = (b: string) => deterministicContext(b, "2026-11-05T10:00:00+09:00", b);

test("日付の読み方: 1 / 11/1 / 11月1日 / 2026-11-01 / 1(土)。無い日は null", () => {
  assert.equal(parseDateCell("1", 2026, 11), "2026-11-01");
  assert.equal(parseDateCell("１０", 2026, 11), "2026-11-10");
  assert.equal(parseDateCell("11/3", 2026, 1), "2026-11-03");
  assert.equal(parseDateCell("11月3日", 2026, 1), "2026-11-03");
  assert.equal(parseDateCell("2026-11-03", 2000, 1), "2026-11-03");
  assert.equal(parseDateCell("1(土)", 2026, 11), "2026-11-01");
  assert.equal(parseDateCell("31", 2026, 11), null);
  assert.equal(parseDateCell("氏名", 2026, 11), null);
});

test("番の略称: 全角半角・「番」の有無をそろえて同じか、先頭一致が 1 つだけ", () => {
  const slots = Object.values(state().roleSlots);
  assert.equal(matchSlot("早A", slots)?.name, "早番A");
  assert.equal(matchSlot("早番Ａ", slots)?.name, "早番A");
  assert.equal(matchSlot("早", slots), null, "早番A と早番B があるので決まらない");
  assert.equal(matchSlot("看", slots)?.name, "看護");
  assert.equal(matchSlot("夜勤東", slots)?.name, "夜勤東");
  assert.equal(matchSlot("ナイト", slots), null);
});

test("勤務表の貼り付け: 名簿と番に照らして日付ごとの出勤者にする。休みの印・空欄は休み。照らせない略称は選ばせ、名簿にない名前は知らせる", () => {
  const s = state();
  const text = ["氏名\t1\t2\t3", "佐藤\t早A\t休\t夜勤東", "高橋 けんた\t\t日B\t早B", "中村\t看\t看\tナイト", "山田 太郎\t早A\t早A\t早A"].join("\n");
  const r = parseRosterPaste(s, text, { year: 2026, month: 12 });
  assert.deepEqual(r.dates, ["2026-12-01", "2026-12-02", "2026-12-03"]);
  assert.equal(r.staffIds.length, 3);
  assert.deepEqual(r.unmatchedNames, [{ line: 5, name: "山田 太郎" }]);
  assert.deepEqual(r.unknownCells, ["ナイト"]);
  assert.equal(rosterPasteEvents(s, r, ctx("x")).length, 0, "照らせない略称が残る間は作らない");
  // 画面で「ナイト」= 夜勤さくら と選ぶ
  const night = Object.values(s.roleSlots).find((x) => x.name === "夜勤さくら")!;
  const r2 = parseRosterPaste(s, text, { year: 2026, month: 12, aliases: { ナイト: night.id } });
  assert.deepEqual(r2.unknownCells, []);
  const evs = rosterPasteEvents(s, r2, ctx("y"));
  assert.equal(evs.filter((e) => e.type === "roster.upsert").length, 9);
  const s2 = applyEvents(s, evs);
  const d1 = rosterForDate(s2, "2026-12-01");
  const sato = Object.values(s.staff).find((x) => x.surname === "佐藤")!;
  const takahashi = Object.values(s.staff).find((x) => x.surname === "高橋")!;
  const e1 = d1.find((e) => e.staffId === sato.id)!;
  assert.equal(s.roleSlots[e1.slotId!].name, "早番A");
  assert.equal(e1.absent, false);
  assert.equal(e1.startMin, s.roleSlots[e1.slotId!].defaultStartMin);
  const e2 = d1.find((e) => e.staffId === takahashi.id)!;
  assert.equal(e2.absent, true, "空欄は休み");
  assert.equal(e2.slotId, undefined);
  const d3 = rosterForDate(s2, "2026-12-03");
  const nakamura = Object.values(s.staff).find((x) => x.surname === "中村")!;
  assert.equal(d3.find((e) => e.staffId === nakamura.id)!.slotId, night.id);
  assert.equal(rosterPasteLabel(r2), "勤務表を入れました（12/1〜12/3・3人）");
  // 朝の帯は、その日の勤務表をそのまま使う
  const draft = morningDraft(s2, "2026-12-01", () => "n");
  assert.equal(draft.source, "today");
  assert.equal(draft.entries.length, 3);
});

test("同じ日を貼り直すと、その日のその職員の行は置き換える。表にいない職員は触らない。元に戻せる", () => {
  const s = state();
  const first = parseRosterPaste(s, "氏名\t1\t2\n佐藤\t早A\t早A\n高橋\t早B\t早B", { year: 2026, month: 12 });
  const s2 = applyEvents(s, rosterPasteEvents(s, first, ctx("a")));
  assert.equal(rosterForDate(s2, "2026-12-01").length, 2);
  const again = parseRosterPaste(s2, "氏名\t1\n佐藤\t遅", { year: 2026, month: 12 });
  const evs = rosterPasteEvents(s2, again, ctx("b"));
  const s3 = applyEvents(s2, evs);
  const d1 = rosterForDate(s3, "2026-12-01");
  assert.equal(d1.length, 2, "高橋の行はそのまま");
  const sato = Object.values(s.staff).find((x) => x.surname === "佐藤")!;
  assert.equal(s3.roleSlots[d1.find((e) => e.staffId === sato.id)!.slotId!].name, "遅番");
  assert.equal(rosterForDate(s3, "2026-12-02").length, 2, "貼っていない日は触らない");
  let cur = s2;
  const history = evs.map((event) => {
    const h = { event, before: cur };
    cur = applyEvents(cur, [event]);
    return h;
  });
  const s4 = applyEvents(s3, invertBatch(history, "b"));
  assert.equal(s4.roleSlots[rosterForDate(s4, "2026-12-01").find((e) => e.staffId === sato.id)!.slotId!].name, "早番A");
});
