import { test } from "node:test";
import assert from "node:assert/strict";

import { himawariSeed } from "../seed/index.ts";
import { deterministicContext, stateFromSeed } from "../loadSeed.ts";
import { applyEvents, invertBatch } from "../reducer.ts";
import { addGroupEvents, groupMembers, removeGroupEvents, removeRoleSlotEvents, renameFacilityEvents, renameGroupEvents, upsertRoleSlotEvents } from "../master.ts";
import { buildOwnFacility } from "../setup.ts";
import { applyPatternEvents, metaOf, morningDraft } from "../pattern.ts";
import { tasksForDate } from "../checks.ts";

const ctx = (b: string) => deterministicContext(b, "2026-11-06T10:00:00+09:00", b);
const own = () => {
  const r = buildOwnFacility({ name: "テスト苑", groupsText: "2階\nあおばユニット", residentsText: "大野 ハル, 2階, 201", staffText: "川口 太郎, 介護職員, 入浴担当可, 811" }, himawariSeed, ctx("own"));
  assert.ok(r.ok, r.problems.join(","));
  return applyEvents(stateFromSeed({ ...himawariSeed, residents: [], staff: [], roster: [], extraTasks: [], extraTargets: [], dayPatterns: [] }, ctx("z")), r.events);
};

test("施設の名前を直す。空は入れない", () => {
  const s = stateFromSeed(himawariSeed, ctx("s"));
  assert.match(renameFacilityEvents(s, " ", ctx("a")).error ?? "", /名前/);
  const r = renameFacilityEvents(s, "ひまわり苑 本館", ctx("a"));
  assert.equal(applyEvents(s, r.events).facility?.name, "ひまわり苑 本館");
  assert.equal(r.label, "施設の名前を「ひまわり苑 本館」にしました");
});

test("グループを足すと、雛形の同じ種類の番と業務表の枠が写り、次の日の時間割に出る。共通は後ろのまま。元に戻せる", () => {
  const s = own();
  const before = Object.values(s.groups).length;
  const r = addGroupEvents(s, "3階", himawariSeed, ctx("g"));
  assert.equal(r.error, undefined);
  const s2 = applyEvents(s, r.events);
  const g = Object.values(s2.groups).find((x) => x.name === "3階")!;
  assert.equal(g.kind, "floor");
  assert.equal(Object.values(s2.groups).length, before + 1);
  const common = Object.values(s2.groups).find((x) => x.kind === "common")!;
  assert.ok(common.sortOrder > g.sortOrder, "共通はいちばん後ろ");
  const slots = Object.values(s2.roleSlots).filter((x) => x.groupId === g.id);
  assert.ok(slots.length >= 3, "そのグループの番が写る");
  assert.ok(slots.some((x) => x.name.includes("3階")), "番の名前にグループ名");
  assert.ok(slots.every((x) => x.leaderRank === undefined), "リーダーの順は写さない");
  const items = Object.values(s2.patterns).flatMap((p) => p.items.filter((it) => it.groupId === g.id));
  assert.ok(items.length > 0, "業務表の枠が写る");
  assert.ok(items.every((it) => it.targetRule !== "residents"));
  assert.ok(items.every((it) => it.slotIds.every((sid) => s2.roleSlots[sid])), "枠の番は施設にある番");
  assert.match(r.label, /グループ「3階」を足しました（番 \d+: .*3階.*・業務表の枠 \d+/);
  // 業務表から作ると、3階の枠が出る
  const draft = morningDraft(s2, "2026-11-09", () => "x");
  const evs = applyPatternEvents(s2, "2026-11-09", draft.patternId!, ctx("p"));
  const s3 = applyEvents(s2, evs);
  assert.ok(tasksForDate(s3, "2026-11-09").some((t) => t.groupId === g.id));
  // 元に戻す
  let cur = s;
  const history = r.events.map((event) => {
    const h = { event, before: cur };
    cur = applyEvents(cur, [event]);
    return h;
  });
  const s4 = applyEvents(s2, invertBatch(history, "g"));
  assert.equal(Object.values(s4.groups).length, before);
  assert.equal(Object.values(s4.roleSlots).filter((x) => x.groupId === g.id).length, 0);
});

test("ユニットの名前なら雛形のユニットから写す。同じ名前は足せない", () => {
  const s = own();
  assert.match(addGroupEvents(s, "2階", himawariSeed, ctx("d")).error ?? "", /もうあります/);
  const r = addGroupEvents(s, "すみれユニット", himawariSeed, ctx("u"));
  const s2 = applyEvents(s, r.events);
  const g = Object.values(s2.groups).find((x) => x.name === "すみれユニット")!;
  assert.equal(g.kind, "unit");
  assert.ok(Object.values(s2.roleSlots).some((x) => x.groupId === g.id && x.name.includes("すみれユニット")));
});

test("グループの名前を直すと、名前を含む番も付け直す。所属が残る間は外せない。空になれば外せて、番と枠も一緒に消える", () => {
  const s = own();
  const g = Object.values(s.groups).find((x) => x.name === "2階")!;
  const r = renameGroupEvents(s, g.id, "1階", ctx("n"));
  const s2 = applyEvents(s, r.events);
  assert.equal(s2.groups[g.id].name, "1階");
  assert.ok(Object.values(s2.roleSlots).filter((x) => x.groupId === g.id).every((x) => !x.name.includes("2階")));
  assert.equal(groupMembers(s2, g.id).residents, 1);
  assert.match(removeGroupEvents(s2, g.id, ctx("r")).error ?? "", /所属しています/);
  // 空のグループ（あおばユニット）は外せる
  const ao = Object.values(s2.groups).find((x) => x.name === "あおばユニット")!;
  assert.deepEqual(groupMembers(s2, ao.id), { residents: 0, staff: 0 });
  const rr = removeGroupEvents(s2, ao.id, ctx("r2"));
  assert.equal(rr.error, undefined);
  const s3 = applyEvents(s2, rr.events);
  assert.equal(s3.groups[ao.id], undefined);
  assert.equal(Object.values(s3.roleSlots).filter((x) => x.groupId === ao.id).length, 0);
  assert.ok(Object.values(s3.patterns).every((p) => p.items.every((it) => it.groupId !== ao.id)));
  assert.match(removeGroupEvents(s3, Object.values(s3.groups).find((x) => x.kind === "common")!.id, ctx("r3")).error ?? "", /共通/);
});

test("番を足す・直す・外す。時刻を変えても入れてある勤務表は変わらない。使われている番は外せない", () => {
  const s = stateFromSeed(himawariSeed, ctx("s"));
  assert.match(upsertRoleSlotEvents(s, { name: "", startMin: 420, endMin: 960 }, ctx("a")).error ?? "", /名前/);
  assert.match(upsertRoleSlotEvents(s, { name: "A勤", startMin: 1500, endMin: 1600 }, ctx("a")).error ?? "", /時刻/);
  // 夜勤を「17:00／9:00」と入れても翌9:00 として受ける
  const night = upsertRoleSlotEvents(s, { name: "夜勤X", startMin: 17 * 60, endMin: 9 * 60 }, ctx("nx"));
  assert.equal(night.error, undefined);
  assert.equal(applyEvents(s, night.events).roleSlots[(night.events[0] as { roleSlot: { id: string } }).roleSlot.id].defaultEndMin, 33 * 60);
  assert.match(upsertRoleSlotEvents(s, { name: "早番A", startMin: 420, endMin: 960 }, ctx("a")).error ?? "", /もうあります/);
  const add = upsertRoleSlotEvents(s, { name: "A勤", startMin: 450, endMin: 990, groupId: Object.values(s.groups)[0].id, leaderRank: 2 }, ctx("b"));
  const s2 = applyEvents(s, add.events);
  const a = Object.values(s2.roleSlots).find((x) => x.name === "A勤")!;
  assert.equal(a.defaultStartMin, 450);
  assert.equal(a.leaderRank, 2);
  // 直す: 早番A の時刻を 7:30 に。11/3 の勤務表（佐藤 早番A 7:00–16:00）はそのまま
  const hayaA = Object.values(s.roleSlots).find((x) => x.name === "早番A")!;
  const fix = upsertRoleSlotEvents(s2, { id: hayaA.id, name: "早番A", startMin: 450, endMin: 960, groupId: hayaA.groupId, leaderRank: hayaA.leaderRank }, ctx("c"));
  const s3 = applyEvents(s2, fix.events);
  assert.equal(s3.roleSlots[hayaA.id].defaultStartMin, 450);
  const sato = Object.values(s.roster).find((e) => e.slotId === hayaA.id && e.date === "2026-11-03")!;
  assert.equal(s3.roster[sato.id].startMin, 420, "入れてある勤務表の時刻はそのまま");
  assert.match(fix.label, /入れてある勤務表の時刻はそのままです/);
  // 外す: 早番A は勤務表と業務表で使われている
  assert.match(removeRoleSlotEvents(s3, hayaA.id, "2026-11-03", ctx("d")).error ?? "", /使われているので外せません/);
  // A勤 は使われていないので外せる
  const rm = removeRoleSlotEvents(s3, a.id, "2026-11-03", ctx("e"));
  assert.equal(rm.error, undefined);
  assert.equal(applyEvents(s3, rm.events).roleSlots[a.id], undefined);
});

test("種類は足すときに選べる。名前を変えても種類は変わらない", () => {
  const s = own();
  const r = addGroupEvents(s, "すみれ", himawariSeed, ctx("k"), "unit");
  const s2 = applyEvents(s, r.events);
  const g = Object.values(s2.groups).find((x) => x.name === "すみれ")!;
  assert.equal(g.kind, "unit", "「ユニット」と付けなくてもユニットにできる");
  const s3 = applyEvents(s2, renameGroupEvents(s2, g.id, "すみれ1丁目", ctx("k2")).events);
  assert.equal(s3.groups[g.id].kind, "unit");
  const ao = Object.values(s3.groups).find((x) => x.name === "あおばユニット")!;
  const s4 = applyEvents(s3, renameGroupEvents(s3, ao.id, "あおば", ctx("k3")).events);
  assert.equal(s4.groups[ao.id].kind, "unit", "「ユニット」を外してもユニットのまま");
});

test("グループの短い名前を含む番も付け直す（夜勤東 → 夜勤1階）", () => {
  const s = stateFromSeed(himawariSeed, ctx("s"));
  const east = Object.values(s.groups).find((x) => x.name === "東フロア")!;
  const r = renameGroupEvents(s, east.id, "1階", ctx("e"));
  const s2 = applyEvents(s, r.events);
  assert.ok(Object.values(s2.roleSlots).some((x) => x.name === "夜勤1階"));
});

test("外した番は先週の写しで休みに並び、番を選び直す", () => {
  const s = stateFromSeed(himawariSeed, ctx("s"));
  const last = Object.values(s.roster).map((e) => e.date).sort().at(-1)!;
  const used = Object.values(s.roster).find((e) => e.date === last && e.slotId && !e.absent)!;
  // 勤務表・業務表の確かめを通さずに外した状態（過去の勤務表だけに残る番）
  const s2 = applyEvents(s, [{ ...metaOf(ctx("rm")), type: "roleSlot.remove", id: used.slotId! }]);
  const next = new Date(`${used.date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 7);
  const draft = morningDraft(s2, next.toISOString().slice(0, 10), () => "x");
  const e = draft.entries.find((x) => x.staffId === used.staffId)!;
  assert.equal(e.slotId, undefined);
  assert.equal(e.absent, true);
});
