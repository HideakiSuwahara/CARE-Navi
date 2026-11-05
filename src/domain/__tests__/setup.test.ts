import { test } from "node:test";
import assert from "node:assert/strict";

import { himawariSeed } from "../seed/index.ts";
import { deterministicContext, stateFromSeed } from "../loadSeed.ts";
import { applyEvents } from "../reducer.ts";
import { buildOwnFacility, facilityCode, parseStaffPaste, settingsEvent } from "../setup.ts";
import { emptyState } from "../types.ts";

test("職員の貼り付け: 名前, 職種, 担当条件, PHS。失敗した行は行番号と理由、ほかは取り込む", () => {
  const r = parseStaffPaste(emptyState(), "野村 ミホ, 介護福祉士, 入浴担当可・喀痰吸引, 811\n\n川口 ジュン\t介護職員\n大野 ケン, 介護助手, , PHSなし\n，介護職員");
  assert.equal(r.staff.length, 2);
  assert.deepEqual(r.staff[0], { line: 1, displayName: "野村 ミホ", surname: "野村", role: "介護福祉士", tags: ["入浴担当可", "喀痰吸引"], phone: "811" });
  assert.equal(r.staff[1].surname, "川口");
  assert.deepEqual(
    r.errors.map((e) => e.line),
    [4, 5],
  );
});

test("自分の施設で始める: 施設・グループ・利用者・職員が入り、業務の種類と業務表が入った状態になる", () => {
  const ctx = deterministicContext("own", "2026-11-03T08:00:00+09:00", "b-own");
  const res = buildOwnFacility(
    {
      name: "みどり荘",
      groupsText: "1階\nあおばユニット\n",
      residentsText: "菅野 ハル, 1階, 101\n熊谷 トメ, あおばユニット, 201\n間違い, 3階, 301",
      staffText: "野村 ミホ, 介護福祉士, , 811\n川口 ジュン, 介護職員",
    },
    himawariSeed,
    ctx,
  );
  assert.equal(res.ok, true);
  assert.deepEqual(res.counts, { groups: 2, residents: 2, staff: 2 });
  assert.equal(res.residentErrors.length, 1);
  assert.equal(res.residentErrors[0].line, 3);
  const s = applyEvents(emptyState(), res.events);
  assert.equal(s.facility?.name, "みどり荘");
  assert.ok(Object.values(s.groups).some((g) => g.name === "あおばユニット" && g.kind === "unit"));
  assert.ok(Object.keys(s.templates).length >= 15, "業務の種類が入る");
  assert.ok(Object.keys(s.patterns).length >= 1, "業務表が入る");
  // 業務表の項目は、入れたグループか共通にだけ付く
  const gids = new Set(Object.keys(s.groups));
  for (const p of Object.values(s.patterns)) for (const it of p.items) assert.ok(!it.groupId || gids.has(it.groupId));
  // サンプルの名前は入らない
  assert.ok(!Object.values(s.staff).some((x) => x.surname === "佐藤"));
  assert.equal(Object.keys(s.tasks).length, 0, "時間割はボードで作る");
});

test("自分の施設で始める: 施設の名前・グループがないと作らない", () => {
  const res = buildOwnFacility({ name: " ", groupsText: "", residentsText: "", staffText: "" }, himawariSeed, deterministicContext("x"));
  assert.equal(res.ok, false);
  assert.equal(res.problems.length, 2);
  assert.equal(res.events.length, 0);
});

test("施設コードは6文字で、同じ施設なら同じ。ふだんの設定は facility.set で変わる", () => {
  assert.equal(facilityCode("fac-himawari").length, 6);
  assert.equal(facilityCode("fac-himawari"), facilityCode("fac-himawari"));
  assert.notEqual(facilityCode("fac-himawari"), facilityCode("fac-other"));
  const s = stateFromSeed(himawariSeed, deterministicContext("h"));
  const ev = settingsEvent(s, { residentDisplayMode: "full", firstTimerOnlyWarning: false }, deterministicContext("p"))!;
  const s2 = applyEvents(s, [ev]);
  assert.equal(s2.facility?.settings.residentDisplayMode, "full");
  assert.equal(s2.facility?.settings.firstTimerOnlyWarning, false);
});

test("自分の施設で始める: 雛形の施設に固有の文・番の名前・対象の方を決めた業務は写さない。グループは種類で当てはめる", () => {
  const res = buildOwnFacility(
    { name: "みどり荘", groupsText: "2階\n3階\nあおばユニット", residentsText: "", staffText: "" },
    himawariSeed,
    deterministicContext("own2", "2026-11-03T08:00:00+09:00", "b-own2"),
  );
  const s = applyEvents(emptyState(), res.events);
  assert.deepEqual(res.mapping, [
    { group: "2階", kind: "従来型" },
    { group: "3階", kind: "従来型" },
    { group: "あおばユニット", kind: "ユニット" },
  ]);
  const slotNames = Object.values(s.roleSlots).map((x) => x.name);
  assert.ok(!slotNames.some((n) => /東|さくら/.test(n)), `雛形のグループ名が残らない: ${slotNames.join("・")}`);
  assert.ok(slotNames.includes("夜勤 2階") && slotNames.includes("夜勤 3階") && slotNames.some((n) => n.includes("あおばユニット")));
  for (const t of Object.values(s.templates)) {
    assert.equal(t.contact, undefined);
    assert.equal(t.supplies, undefined);
  }
  for (const p of Object.values(s.patterns)) for (const it of p.items) assert.notEqual(it.targetRule, "residents");
  assert.ok(res.skippedPersonal.length > 0);
  // 2階と3階の両方に従来型の業務が入る
  const g2 = Object.values(s.groups).find((g) => g.name === "2階")!.id;
  const g3 = Object.values(s.groups).find((g) => g.name === "3階")!.id;
  const p0 = Object.values(s.patterns)[0];
  assert.ok(p0.items.some((it) => it.groupId === g2) && p0.items.some((it) => it.groupId === g3));
  // 業務の番は実在する番だけ
  for (const p of Object.values(s.patterns)) for (const it of p.items) for (const sid of it.slotIds) assert.ok(s.roleSlots[sid], sid);
});

test("職員の貼り付け: 見出し行は飛ばす。区切りがない行・1列目が数字の行は理由つきで止める", () => {
  const r = parseStaffPaste(emptyState(), "氏名, 職種\n1001, 野村, 介護職員\n野村 ミホ 介護職員\n川口ジュン, 介護職員");
  assert.equal(r.staff.length, 1);
  assert.equal(r.staff[0].noSpace, true);
  assert.match(r.errors.find((e) => e.line === 2)!.reason, /数字/);
  assert.match(r.errors.find((e) => e.line === 3)!.reason, /区切り/);
});

test("職員の担当条件: 業務の種類が使う条件が先に並び、付ける／外すは 1 イベントで元に戻せる。等級は持たない", async () => {
  const { conditionTags, setStaffTagEvents, staffTagLabel, usedByTemplates } = await import("../setup.ts");
  const { applyEvents, invertBatch } = await import("../reducer.ts");
  const { himawariSeed } = await import("../seed/index.ts");
  const { deterministicContext, stateFromSeed } = await import("../loadSeed.ts");
  const s = stateFromSeed(himawariSeed, deterministicContext("t"));
  const tags = conditionTags(s);
  assert.deepEqual(tags.slice(0, 2), ["入浴担当可", "看護師"]);
  assert.ok(tags.includes("介護福祉士"));
  assert.equal(usedByTemplates(s, "入浴担当可"), true);
  assert.equal(usedByTemplates(s, "介護福祉士"), false);
  const nakamura = Object.values(s.staff).find((x) => x.surname === "中村")!;
  assert.ok(!nakamura.tags.includes("入浴担当可"));
  const ctx = deterministicContext("u", "2026-11-05T10:00:00+09:00", "b-tag");
  const evs = setStaffTagEvents(s, nakamura.id, "入浴担当可", true, ctx);
  assert.equal(evs.length, 1);
  const s2 = applyEvents(s, evs);
  assert.ok(s2.staff[nakamura.id].tags.includes("入浴担当可"));
  assert.equal(staffTagLabel(s, nakamura.id, "入浴担当可", true), "中村さんの担当条件に「入浴担当可」を付けました");
  // 既に持っている／持っていないときは何もしない。空の条件も付けない
  assert.equal(setStaffTagEvents(s2, nakamura.id, "入浴担当可", true, ctx).length, 0);
  assert.equal(setStaffTagEvents(s, nakamura.id, "入浴担当可", false, ctx).length, 0);
  assert.equal(setStaffTagEvents(s, nakamura.id, "  ", true, ctx).length, 0);
  // 元に戻す
  const s3 = applyEvents(s2, invertBatch(evs.map((event) => ({ event, before: s })), "b-tag"));
  assert.deepEqual(s3.staff[nakamura.id].tags, nakamura.tags);
  // 外す
  const s4 = applyEvents(s2, setStaffTagEvents(s2, nakamura.id, "入浴担当可", false, deterministicContext("v", "2026-11-05T10:01:00+09:00", "b-tag2")));
  assert.deepEqual(s4.staff[nakamura.id].tags, nakamura.tags);
});
