/**
 * シード（架空施設）→ イベント列。
 * マスター → 出勤者 → 手で足した予定 → 日付ごとに型を当てる、の順。
 */

import type { Event } from "./events.ts";
import { applyPatternEvents, metaOf, type EventContext } from "./pattern.ts";
import { applyEvents } from "./reducer.ts";
import { emptyState, type SeedData, type State } from "./types.ts";

export function seedToEvents(seed: SeedData, ctx: EventContext): Event[] {
  const events: Event[] = [];
  events.push({ ...metaOf(ctx), type: "facility.set", facility: seed.facility });
  for (const group of seed.groups) events.push({ ...metaOf(ctx), type: "group.upsert", group });
  for (const resident of seed.residents) events.push({ ...metaOf(ctx), type: "resident.upsert", resident });
  for (const staff of seed.staff) events.push({ ...metaOf(ctx), type: "staff.upsert", staff });
  for (const roleSlot of seed.roleSlots) events.push({ ...metaOf(ctx), type: "roleSlot.upsert", roleSlot });
  for (const template of seed.templates) events.push({ ...metaOf(ctx), type: "template.upsert", template });
  for (const pattern of seed.patterns) events.push({ ...metaOf(ctx), type: "pattern.upsert", pattern });
  for (const entry of seed.roster) events.push({ ...metaOf(ctx), type: "roster.upsert", entry });
  for (const task of seed.extraTasks) {
    const residentIds = seed.extraTargets.filter((t) => t.taskId === task.id).map((t) => t.residentId);
    events.push({ ...metaOf(ctx), type: "task.add", task: { ...task, origin: task.origin ?? "manual" }, residentIds });
  }

  // 型を当てる（日付ごと）。途中状態が必要なので逐次適用する
  let state: State = applyEvents(emptyState(), events);
  for (const dp of seed.dayPatterns) {
    const evs = applyPatternEvents(state, dp.date, dp.patternId, ctx);
    events.push(...evs);
    state = applyEvents(state, evs);
  }
  return events;
}

export function stateFromSeed(seed: SeedData, ctx: EventContext): State {
  return applyEvents(emptyState(), seedToEvents(seed, ctx));
}

/** テストやサンプル用: 連番IDで決定的に作る */
export function deterministicContext(prefix = "ev", ts = "2026-11-03T06:00:00+09:00", batchId = "seed"): EventContext {
  let n = 0;
  return { newId: () => `${prefix}-${(++n).toString().padStart(5, "0")}`, ts, batchId };
}
