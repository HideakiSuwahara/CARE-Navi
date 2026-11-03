import { test } from "node:test";
import assert from "node:assert/strict";

import { himawariSeed } from "../seed/index.ts";
import { deterministicContext, stateFromSeed } from "../loadSeed.ts";
import { applyEvents } from "../reducer.ts";
import { buildOwnFacility, facilityCode, parseStaffPaste, settingsEvent } from "../setup.ts";
import { emptyState } from "../types.ts";

test("職員の貼り付け: 名前, 職種, 担当条件, PHS。失敗した行は行番号と理由、ほかは取り込む", () => {
  const r = parseStaffPaste(emptyState(), "青木 ミホ, 介護福祉士, 入浴担当可・喀痰吸引, 811\n\n石田 ジュン\t介護職員\n前田 ケン, 介護助手, , PHSなし\n，介護職員");
  assert.equal(r.staff.length, 2);
  assert.deepEqual(r.staff[0], { line: 1, displayName: "青木 ミホ", surname: "青木", role: "介護福祉士", tags: ["入浴担当可", "喀痰吸引"], phone: "811" });
  assert.equal(r.staff[1].surname, "石田");
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
      residentsText: "岡田 ハル, 1階, 101\n小池 トメ, あおばユニット, 201\n間違い, 3階, 301",
      staffText: "青木 ミホ, 介護福祉士, , 811\n石田 ジュン, 介護職員",
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
