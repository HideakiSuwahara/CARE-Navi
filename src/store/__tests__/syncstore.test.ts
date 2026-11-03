import { test } from "node:test";
import assert from "node:assert/strict";

import type { Event } from "../../domain/events.ts";
import { SyncStore, type SyncClient } from "../syncstore.ts";

const ev = (id: string): Event => ({ eventId: id, ts: "2026-11-03T10:00:00+09:00", batchId: `b-${id}`, type: "staff.remove", id: "x" });

/** 偽の遠くの保存。failing を true にすると届かない */
function fakeClient() {
  const rows: Event[] = [];
  const subs = new Set<(evs: Event[]) => void>();
  const c: SyncClient & { rows: Event[]; failing: boolean; push: (evs: Event[]) => void } = {
    rows,
    failing: false,
    async fetchAll() {
      if (c.failing) throw new Error("届かない");
      return [...rows];
    },
    async insert(_code, events) {
      if (c.failing) throw new Error("届かない");
      const known = new Set(rows.map((e) => e.eventId));
      for (const e of events) if (!known.has(e.eventId)) rows.push(e);
    },
    onInsert(_code, cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    push(evs) {
      rows.push(...evs);
      for (const cb of subs) cb(evs);
    },
  };
  return c;
}

test("読み込み: 遠くの保存が正。届いたイベントは購読者に配り、自分が送ったものは配らない", async () => {
  const client = fakeClient();
  client.rows.push(ev("r1"), ev("r2"));
  const store = new SyncStore("TEST01", client);
  const got: Event[] = [];
  store.subscribe((evs) => got.push(...evs));
  const loaded = await store.load();
  assert.deepEqual(
    loaded.map((e) => e.eventId),
    ["r1", "r2"],
  );
  assert.equal(store.status, "online");
  await store.append([ev("mine")]);
  assert.equal(client.rows.length, 3);
  // 自分の分が Realtime で返ってきても配らない
  client.push([ev("mine")]);
  assert.equal(got.length, 0);
  // ほかの端末の分は配る
  client.push([ev("other")]);
  assert.deepEqual(
    got.map((e) => e.eventId),
    ["other"],
  );
  store.stop();
});

test("届かないとき: キャッシュで動き、未送信を残して、次に届いたときに送る", async () => {
  const client = fakeClient();
  client.failing = true;
  const store = new SyncStore("TEST02", client);
  await store.load();
  assert.equal(store.status, "offline");
  await store.append([ev("p1")]);
  assert.equal(store.pendingCount, 1);
  assert.equal(client.rows.length, 0);
  client.failing = false;
  await store.append([ev("p2")]);
  assert.equal(store.pendingCount, 0);
  assert.deepEqual(
    client.rows.map((e) => e.eventId),
    ["p1", "p2"],
  );
  assert.equal(store.status, "online");
  store.stop();
});
