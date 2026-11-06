import { test } from "node:test";
import assert from "node:assert/strict";

import { Engine, type UndoEntry } from "../engine.ts";
import { MemoryStore } from "../datastore.ts";
import { seedToEvents, deterministicContext } from "../../domain/loadSeed.ts";
import { assignEvents, escortPreview, setDoneEvents } from "../../domain/commands.ts";
import { headcountStatus } from "../../domain/checks.ts";
import { toMin } from "../../domain/time.ts";
import { DATE, findTask, miniSeed } from "../../domain/__tests__/fixture.ts";

function makeEngine() {
  const store = new MemoryStore(seedToEvents(miniSeed(), deterministicContext("s")));
  let n = 0;
  const engine = new Engine({ store, newId: () => `e-${++n}`, now: () => new Date("2026-11-03T10:12:00+09:00"), historyLimit: 3 });
  return { engine, store };
}

test("start で保存済みイベントから状態ができる", async () => {
  const { engine } = makeEngine();
  await engine.start();
  assert.ok(engine.ready);
  assert.equal(engine.state.facility?.name, "テスト苑");
  assert.equal(Object.keys(engine.state.tasks).length, 5);
});

test("dispatch → undo で元に戻り、打ち消しも保存される", async () => {
  const { engine, store } = makeEngine();
  await engine.start();
  const bath = findTask(engine.state, "入浴介助");
  const before = (await store.load()).length;

  await engine.dispatch(assignEvents(bath.id, "s-kato", engine.context()), "加藤さんを「入浴介助 10:30」に割り当てました");
  assert.equal(headcountStatus(engine.state, bath.id).label, "OK");
  assert.ok(engine.canUndo);
  assert.equal(engine.lastUndo?.label, "加藤さんを「入浴介助 10:30」に割り当てました");
  assert.equal((await store.load()).length, before + 1);

  const undone = await engine.undo();
  assert.ok(undone);
  assert.equal(headcountStatus(engine.state, bath.id).label, "担当あと1人");
  assert.equal(engine.canUndo, false);
  assert.equal((await store.load()).length, before + 2, "打ち消しイベントも追記される");
});

test("クイック操作は1バッチで戻る", async () => {
  const { engine } = makeEngine();
  await engine.start();
  const s0 = engine.state;
  const preview = escortPreview(
    s0,
    { date: DATE, residentId: "r-101", startMin: toMin(10, 30), endMin: toMin(12), staffId: "s-suzuki" },
    engine.context(),
  );
  await engine.dispatch(preview.events, "受診の付き添いを追加しました");
  assert.equal(Object.keys(engine.state.tasks).length, 7, "付き添い＋ずらした休憩");
  await engine.undo();
  assert.equal(Object.keys(engine.state.tasks).length, 5);
  assert.deepEqual(Object.keys(engine.state.assignments).sort(), Object.keys(s0.assignments).sort());
});

test("他の端末からのイベントは状態に反映されるが、履歴には積まれない", async () => {
  const { engine, store } = makeEngine();
  await engine.start();
  const bath = findTask(engine.state, "入浴介助");
  let notified = 0;
  engine.subscribe(() => notified++);
  store.emit(assignEvents(bath.id, "s-kato", deterministicContext("remote", "2026-11-03T10:13:00+09:00", "remote-batch")));
  assert.equal(headcountStatus(engine.state, bath.id).label, "OK");
  assert.equal(engine.canUndo, false);
  assert.ok(notified >= 1);
});

test("履歴は上限まで。古いものから戻せなくなる", async () => {
  const { engine } = makeEngine();
  await engine.start();
  const bath = findTask(engine.state, "入浴介助");
  const linen = findTask(engine.state, "リネン回収");
  const oral = findTask(engine.state, "口腔ケア");
  const watch = findTask(engine.state, "見守り");
  await engine.dispatch(assignEvents(bath.id, "s-kato", engine.context()), "1");
  await engine.dispatch(assignEvents(linen.id, "s-kato", engine.context()), "2");
  await engine.dispatch(assignEvents(oral.id, "s-suzuki", engine.context()), "3");
  await engine.dispatch(assignEvents(watch.id, "s-kato", engine.context()), "4");
  const labels: string[] = [];
  while (engine.canUndo) {
    const u = await engine.undo();
    if (u) labels.push(u.label);
  }
  assert.deepEqual(labels, ["4", "3", "2"]);
});


test("「元に戻す」の一覧を残しておくと、作り直した Engine でも戻せる（イベント列から打ち消しの状態を作り直す）", async () => {
  const { engine, store } = makeEngine();
  void engine;
  const saved: { log: UndoEntry[] } = { log: [] };
  const undoLog = { load: () => [...saved.log], save: (e: UndoEntry[]) => void (saved.log = [...e]) };
  let n = 0;
  const e1 = new Engine({ store, newId: () => `u-${++n}`, now: () => new Date("2026-11-03T10:12:00+09:00"), undoLog });
  await e1.start();
  const bath = findTask(e1.state, "入浴介助");
  await e1.dispatch(assignEvents(bath.id, "s-kato", e1.context()), "加藤さんを入れました");
  assert.equal(headcountStatus(e1.state, bath.id).assigned, 3);
  assert.equal(saved.log.length, 1);
  // 読み込み直し（別の Engine）
  const e2 = new Engine({ store, newId: () => `v-${++n}`, now: () => new Date("2026-11-03T10:13:00+09:00"), undoLog });
  await e2.start();
  assert.equal(e2.lastUndo?.label, "加藤さんを入れました");
  const done = await e2.undo();
  assert.ok(done);
  assert.equal(headcountStatus(e2.state, bath.id).assigned, 2);
  assert.equal(saved.log.length, 0);
});

test("元に戻すは操作が触った日と「終わった」の印だけかを覚え、見ている日の操作だけを選べる（ループ 19）", async () => {
  const { engine } = makeEngine();
  await engine.start();
  const bath = findTask(engine.state, "入浴介助");
  await engine.dispatch(assignEvents(bath.id, "s-kato", engine.context()), "割り当て");
  assert.deepEqual(engine.lastUndo?.dates, [DATE]);
  assert.equal(engine.lastUndo?.doneOnly, undefined);
  await engine.dispatch(setDoneEvents(bath.id, true, engine.context()), "終わった");
  assert.equal(engine.lastUndo?.doneOnly, true);
  // 別の日を見ているときは、この日の操作は選ばれない
  assert.equal(engine.lastUndoWhere((u) => !u.dates || u.dates.includes("2026-11-05")), null);
  // 自分の予定は「終わった」の印だけ
  assert.equal(engine.lastUndoWhere((u) => Boolean(u.doneOnly))?.label, "終わった");
  // 見ている日の割り当てだけを戻す（印は残る）
  const assign = engine.lastUndoWhere((u) => !u.doneOnly)!;
  await engine.undo(assign.batchId);
  assert.equal(engine.lastUndo?.label, "終わった");
});

test("履歴: 見ている日の操作を新しい順に並べ、選んだところまで新しい方から戻す（決定記録 0021）", async () => {
  const { engine } = makeEngine();
  await engine.start();
  const bath = findTask(engine.state, "入浴介助");
  await engine.dispatch(assignEvents(bath.id, "s-kato", engine.context()), "1 つ目");
  await engine.dispatch(setDoneEvents(bath.id, true, engine.context()), "2 つ目");
  await engine.dispatch(setDoneEvents(bath.id, false, engine.context()), "3 つ目");
  const pred = (u: UndoEntry) => !u.dates || u.dates.includes(DATE);
  assert.deepEqual(engine.undoListWhere(pred).map((u) => u.label), ["3 つ目", "2 つ目", "1 つ目"]);
  const target = engine.undoListWhere(pred)[1];
  const done = await engine.undoThrough(target.batchId, pred);
  assert.deepEqual(done.map((u) => u.label), ["3 つ目", "2 つ目"]);
  assert.deepEqual(engine.undoListWhere(pred).map((u) => u.label), ["1 つ目"]);
  assert.equal(Boolean(engine.state.tasks[bath.id].done), false);
});
