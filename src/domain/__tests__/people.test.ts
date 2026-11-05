import { test } from "node:test";
import assert from "node:assert/strict";

import { himawariSeed } from "../seed/index.ts";
import { deterministicContext, stateFromSeed } from "../loadSeed.ts";
import { applyEvents, invertBatch } from "../reducer.ts";
import { removeResidentEvents, removeStaffEvents, residentFormEvents, residentFutureTargets, staffFormEvents, staffFutureAssignments } from "../people.ts";

const DATE = "2026-11-03";
const state = () => stateFromSeed(himawariSeed, deterministicContext("p"));
const ctx = (b: string) => deterministicContext(b, "2026-11-03T10:00:00+09:00", b);

test("職員を 1 人ずつ足す・直す: 名前・職種は必須、PHS は数字、同じ名前は足せない。貼り付けと同じイベントで元に戻せる", () => {
  const s = state();
  assert.match(staffFormEvents(s, { displayName: "", role: "介護職員", tags: [] }, ctx("a")).error ?? "", /名前/);
  assert.match(staffFormEvents(s, { displayName: "野村 ミホ", role: "", tags: [] }, ctx("a")).error ?? "", /職種/);
  assert.match(staffFormEvents(s, { displayName: "野村 ミホ", role: "介護職員", tags: [], phone: "abc" }, ctx("a")).error ?? "", /PHS/);
  assert.match(staffFormEvents(s, { displayName: "佐藤 みき", role: "介護職員", tags: [] }, ctx("a")).error ?? "", /すでに/);
  const add = staffFormEvents(s, { displayName: "野村　ミホ", role: "介護福祉士", tags: ["入浴担当可", "入浴担当可", " "], phone: "811" }, ctx("a"));
  assert.equal(add.error, undefined);
  assert.equal(add.events.length, 1);
  const s2 = applyEvents(s, add.events);
  const added = Object.values(s2.staff).find((x) => x.displayName === "野村 ミホ")!;
  assert.equal(added.surname, "野村");
  assert.deepEqual(added.tags, ["入浴担当可"]);
  assert.equal(added.phone, "811");
  assert.match(add.label, /野村さんを足しました/);
  // 直す: PHS を消す
  const fix = staffFormEvents(s2, { id: added.id, displayName: "野村 ミホ", role: "介護福祉士", tags: added.tags, phone: "" }, ctx("b"));
  const s3 = applyEvents(s2, fix.events);
  assert.equal(s3.staff[added.id].phone, undefined);
  assert.equal(fix.label, "野村さんを直しました");
  // 元に戻す
  const s4 = applyEvents(s3, invertBatch(fix.events.map((event) => ({ event, before: s2 })), "b"));
  assert.equal(s4.staff[added.id].phone, "811");
});

test("退職: 今日以降の担当と出勤を外して職員を外す（過去の担当は履歴として残る）。元に戻すで全部戻る", () => {
  const s = state();
  const takahashi = Object.values(s.staff).find((x) => x.surname === "高橋")!;
  const TODAY = DATE;
  const before = staffFutureAssignments(s, takahashi.id, TODAY);
  assert.ok(before > 0);
  // 11/4 を今日にすると、11/3 の担当は数えない（過去）
  const onlyTomorrow = Object.values(s.assignments).filter((a) => a.staffId === takahashi.id && (s.tasks[a.taskId]?.date ?? "") >= "2026-11-04").length;
  assert.equal(staffFutureAssignments(s, takahashi.id, "2026-11-04"), onlyTomorrow);
  const r = removeStaffEvents(s, takahashi.id, TODAY, ctx("c"));
  assert.equal(r.assignments, before);
  assert.ok(r.rosterDays >= 1);
  const s2 = applyEvents(s, r.events);
  assert.equal(s2.staff[takahashi.id], undefined);
  assert.equal(Object.values(s2.assignments).filter((a) => a.staffId === takahashi.id && (s.tasks[a.taskId]?.date ?? "") >= TODAY).length, 0);
  assert.equal(Object.values(s2.roster).filter((e) => e.staffId === takahashi.id && e.date >= TODAY).length, 0);
  assert.match(r.label, /高橋さんを退職にしました（今日以降の担当 \d+件から外れました）/);
  // 元に戻す（1 バッチ）
  let cur = s;
  const history = r.events.map((event) => {
    const h = { event, before: cur };
    cur = applyEvents(cur, [event]);
    return h;
  });
  const s3 = applyEvents(s2, invertBatch(history, "c"));
  assert.ok(s3.staff[takahashi.id]);
  assert.equal(staffFutureAssignments(s3, takahashi.id, TODAY), before);
});

test("利用者を 1 人ずつ足す・直す・退所。退所は対象から外れ、元に戻すと対象にも戻る", () => {
  const s = state();
  const east = Object.values(s.groups).find((g) => g.name === "東フロア")!;
  assert.match(residentFormEvents(s, { displayName: "山田 キヨ", groupId: east.id, room: "999" }, ctx("d")).error ?? "", /すでに/);
  const add = residentFormEvents(s, { displayName: "山本 ハル", groupId: east.id, room: "120" }, ctx("d"));
  assert.equal(add.error, undefined);
  const s2 = applyEvents(s, add.events);
  const haru = Object.values(s2.residents).find((x) => x.displayName === "山本 ハル")!;
  assert.equal(haru.room, "120");
  const fix = residentFormEvents(s2, { id: haru.id, displayName: "山本 ハル", groupId: east.id, room: "121" }, ctx("e"));
  assert.equal(applyEvents(s2, fix.events).residents[haru.id].room, "121");
  // 退所: 対象に入っている方
  const tanaka = Object.values(s.residents).find((x) => x.surname === "田中")!;
  const n = residentFutureTargets(s, tanaka.id, DATE);
  assert.ok(n > 0);
  const rm = removeResidentEvents(s, tanaka.id, DATE, ctx("f"));
  assert.equal(rm.targets, n);
  const s5 = applyEvents(s, rm.events);
  assert.equal(s5.residents[tanaka.id], undefined);
  assert.equal(residentFutureTargets(s5, tanaka.id, DATE), 0, "今日以降の枠の対象から外れる");
  // 今日より前の枠（10/27 など）が対象に残っているなら、それは履歴として変えない
  const pastKept = Object.entries(s.targets).filter(([taskId, ids]) => ids.includes(tanaka.id) && (s.tasks[taskId]?.date ?? "") < DATE);
  for (const [taskId] of pastKept) assert.ok(s5.targets[taskId].includes(tanaka.id));
  assert.match(rm.label, /田中様を退所にしました（今日以降の時間割 \d+枠の対象から外れました）/);
  const s6 = applyEvents(s5, invertBatch(rm.events.map((event) => ({ event, before: s })), "f"));
  assert.ok(s6.residents[tanaka.id]);
  assert.equal(residentFutureTargets(s6, tanaka.id, DATE), n);
});
