/**
 * サンプル施設（架空の「ひまわり苑」）の読み込み。
 * - 初回（保存が空）なら、シードからイベント列を作って保存する。0 入力で全画面が動く。
 * - 「サンプルに戻す」は同じイベント列で作り直す。
 * デモの基準日は 2026-11-03（火・入浴日）。
 */

import { himawariSeed } from "../domain/seed/index.ts";
import { deterministicContext, seedToEvents } from "../domain/loadSeed.ts";
import type { Event } from "../domain/events.ts";

export const SAMPLE_DATE = "2026-11-03";
/** サンプル施設の ID（シードの施設） */
export const SAMPLE_FACILITY_ID = "fac-himawari";

export function sampleEvents(): Event[] {
  return seedToEvents(himawariSeed, deterministicContext("seed", "2026-11-03T06:00:00+09:00", "seed"));
}
