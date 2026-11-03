"use client";

/**
 * React から Engine を使うための薄い層。
 * - EngineProvider: ブラウザで1つだけ Engine を作り、保存が空ならサンプル施設を入れる。
 * - useAppState(): 現在の状態（イベント列から作った State）を購読する。
 * - useEngine(): dispatch / undo / context を呼ぶ。
 * - useNowMinutes(): 現在時刻（業務日 0:00 起点の分）。1分ごとに更新。デモ用に固定もできる。
 */

import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { Engine } from "./engine.ts";
import { LocalStore, type DataStore, type SyncStatus } from "./datastore.ts";
import { sampleEvents } from "./sample.ts";
import { supabaseEnv, supabaseSyncClient } from "./supabaseClient.ts";
import { readSyncCode } from "./syncJoin.ts";
import { SyncStore } from "./syncstore.ts";

/** 保存層を選ぶ: 施設コードで参加していて、環境変数がそろっていれば同期。それ以外はブラウザ内保存 */
function chooseStore(): DataStore {
  const code = readSyncCode();
  const env = supabaseEnv();
  if (code && env) return new SyncStore(code, supabaseSyncClient(env));
  return new LocalStore();
}
import { emptyState, type State } from "../domain/types.ts";

const EngineContext = createContext<Engine | null>(null);

export function EngineProvider({ children }: { children: ReactNode }) {
  const engine = useMemo(() => {
    if (typeof window === "undefined") return null;
    return new Engine({ store: chooseStore() });
  }, []);

  useEffect(() => {
    if (!engine) return;
    let cancelled = false;
    (async () => {
      await engine.start();
      if (cancelled) return;
      // 同期で参加した端末は、遠くの保存が空でもサンプルを入れない（施設の内容はコードを発行した端末が送る）
      if (!engine.state.facility && engine.storeKind !== "sync") await engine.reset(sampleEvents());
    })();
    return () => {
      cancelled = true;
      engine.stop();
    };
  }, [engine]);

  return <EngineContext.Provider value={engine}>{children}</EngineContext.Provider>;
}

export function useEngine(): Engine | null {
  return useContext(EngineContext);
}

const EMPTY = emptyState();

export function useAppState(): { state: State; ready: boolean } {
  const engine = useEngine();
  const state = useSyncExternalStore(
    (cb) => (engine ? engine.subscribe(cb) : () => {}),
    () => engine?.state ?? EMPTY,
    () => EMPTY,
  );
  return { state, ready: Boolean(engine?.ready && state.facility) };
}

/** 同期の状態（見出しの「同期中」「この端末の内容」）。local は常に "local" */
export function useSyncStatus(): { kind: DataStore["kind"]; status: SyncStatus } {
  const engine = useEngine();
  const status = useSyncExternalStore(
    (cb) => (engine ? engine.subscribeStatus(cb) : () => {}),
    () => engine?.syncStatus ?? "local",
    () => "local" as SyncStatus,
  );
  return { kind: engine?.storeKind ?? "local", status };
}

function minutesOf(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * 現在時刻（分）。URL に ?now=10:12 があればその時刻に固定する（デモ・動画用）。
 */
export function useNowMinutes(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const fixed = new URLSearchParams(window.location.search).get("now");
    if (fixed && /^\d{1,2}:\d{2}$/.test(fixed)) {
      const [h, m] = fixed.split(":").map(Number);
      setNow(h * 60 + m);
      return;
    }
    setNow(minutesOf(new Date()));
    const id = window.setInterval(() => setNow(minutesOf(new Date())), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}
