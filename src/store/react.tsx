"use client";

/**
 * React から Engine を使うための薄い層。
 * - EngineProvider: ブラウザで1つだけ Engine を作り、保存が空ならサンプル施設を入れる。
 * - useAppState(): 現在の状態（イベント列から作った State）を購読する。
 * - useEngine(): dispatch / undo / context を呼ぶ。
 * - useNowMinutes(): 現在時刻（業務日 0:00 起点の分）。1分ごとに更新。デモ用に固定もできる。
 */

import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { Engine, localUndoLog } from "./engine.ts";
import { LocalStore, type DataStore, type SyncStatus } from "./datastore.ts";
import { SAMPLE_DATE, SAMPLE_FACILITY_ID, sampleEvents } from "./sample.ts";
import { businessDateOf, calendarDateOf } from "../domain/time.ts";
import { supabaseEnv, supabaseSyncClient } from "./supabaseClient.ts";
import { readSyncCode } from "./syncJoin.ts";
import { SyncStore } from "./syncstore.ts";

/** 保存層を選ぶ: 施設コードで参加していて、環境変数がそろっていれば同期。それ以外はブラウザ内保存 */
function chooseStore(): { store: DataStore; undoKey: string } {
  const code = readSyncCode();
  const env = supabaseEnv();
  if (code && env) return { store: new SyncStore(code, supabaseSyncClient(env)), undoKey: `care-navi.undo.sync.${code}` };
  return { store: new LocalStore(), undoKey: "care-navi.undo.local" };
}
import { emptyState, type State } from "../domain/types.ts";

const EngineContext = createContext<Engine | null>(null);

export function EngineProvider({ children }: { children: ReactNode }) {
  const engine = useMemo(() => {
    if (typeof window === "undefined") return null;
    const { store, undoKey } = chooseStore();
    // 「元に戻す」の一覧は端末に残す（読み込み直しても戻せる。10手）
    return new Engine({ store, undoLog: localUndoLog(undoKey) });
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

export function useAppState(): { state: State; ready: boolean; loaded: boolean } {
  const engine = useEngine();
  const state = useSyncExternalStore(
    (cb) => (engine ? engine.subscribe(cb) : () => {}),
    () => engine?.state ?? EMPTY,
    () => EMPTY,
  );
  // loaded: 保存を読み終えた（施設がなくても true。同期で空のコードに参加したときの案内に使う）
  return { state, ready: Boolean(engine?.ready && state.facility), loaded: Boolean(engine?.ready) };
}

/** ほかの端末・タブから届いた回数（増えたら「ほかの端末で変更がありました」を出す） */
export function useIncoming(): { count: number; at: string | null } {
  const engine = useEngine();
  const count = useSyncExternalStore(
    (cb) => (engine ? engine.subscribe(cb) : () => {}),
    () => engine?.incomingCount ?? 0,
    () => 0,
  );
  return { count, at: engine?.incomingAt ?? null };
}

/** 同期の状態（見出しの「同期中」「この端末の内容」）。local は常に "local" */
export function useSyncStatus(): { kind: DataStore["kind"]; status: SyncStatus; pending: number } {
  const engine = useEngine();
  const status = useSyncExternalStore(
    (cb) => (engine ? engine.subscribeStatus(cb) : () => {}),
    () => engine?.syncStatus ?? "local",
    () => "local" as SyncStatus,
  );
  return { kind: engine?.storeKind ?? "local", status, pending: engine?.pendingCount ?? 0 };
}

function minutesOf(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * 現在時刻（分）。URL に ?now=10:12 があればその時刻に固定する（デモ・動画用）。
 */
/** サンプル施設の時計の始まり（決定記録 0018）。開いた瞬間を 10:12 として、実時間で進む */
export const SAMPLE_START_MIN = 10 * 60 + 12;
let sampleOpenedAt: number | null = null;
/** サンプル施設の「いま」（分）。ページを開いてからの経過分を 10:12 に足す */
export function sampleNowMinutes(nowMs: number = Date.now()): number {
  if (sampleOpenedAt === null) sampleOpenedAt = nowMs;
  return Math.min(SAMPLE_START_MIN + Math.floor((nowMs - sampleOpenedAt) / 60_000), 2879);
}

export function useNowMinutes(): number | null {
  const { state, ready, loaded } = useAppState();
  const sample = isSampleFacility(state);
  // 施設が読めるまでは時計を返さない（サンプルかどうかで「いま」が変わる。先に実時刻でスクロールしないように）
  const known = ready || loaded;
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!known) return;
    const fixed = new URLSearchParams(window.location.search).get("now");
    if (fixed && /^\d{1,2}:\d{2}$/.test(fixed)) {
      const [h, m] = fixed.split(":").map(Number);
      setNow(h * 60 + m);
      return;
    }
    // サンプル施設は 11/3 の一日を見せるので、時計も 10:12 から進める（いつ開いても見せ場が画面に入る。決定記録 0018）
    const read = () => setNow(sample ? sampleNowMinutes() : minutesOf(new Date()));
    read();
    const id = window.setInterval(read, sample ? 15_000 : 30_000);
    return () => window.clearInterval(id);
  }, [sample, known]);
  return known ? now : null;
}

/** サンプル施設（ひまわり苑）か。サンプルは基準日（11/3）の一日を見せる */
export function isSampleFacility(state: State): boolean {
  return state.facility?.id === SAMPLE_FACILITY_ID;
}

/**
 * URL に ?date= がないときに開く日。サンプル施設は基準日、自分の施設は端末の今日。
 * kind = "business" はボード（6:00 より前は前の日）、"calendar" は自分の予定（夜勤明けは viewerDay が前の日を開く）。
 * 描き始め（端末の時計を読む前）は null。
 */
export function useDefaultDate(state: State, kind: "business" | "calendar"): string | null {
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => {
    const read = () => setToday(kind === "business" ? businessDateOf(new Date()) : calendarDateOf(new Date()));
    read();
    // 日付が変わったら追いかける（開きっぱなしのボード）
    const id = window.setInterval(read, 60_000);
    return () => window.clearInterval(id);
  }, [kind]);
  if (isSampleFacility(state)) return SAMPLE_DATE;
  return today;
}
