import { test } from "node:test";
import assert from "node:assert/strict";

import { Engine } from "../engine.ts";
import { MemoryStore } from "../datastore.ts";
import { seedToEvents, deterministicContext } from "../../domain/loadSeed.ts";
import { assignEvents, escortPreview } from "../../domain/commands.ts";
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
    { date: DATE, name: "受診の付き添い", residentId: "r-101", startMin: toMin(10, 30), endMin: toMin(12), staffId: "s-suzuki" },
    engine.context(),
  );
  await engine.dispatch(preview.events, "受診の付き添いを追加しました");
  assert.equal(Object.keys(engine.state.tasks).length, 6);
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
