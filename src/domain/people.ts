/**
 * 職員・利用者を 1 人ずつ足す・直す・外す（グリル 2026-11-05 職員の個別の入力、決定記録 0015）。
 * - 貼り付けと同じイベント（staff.upsert / resident.upsert）。1 操作 1 バッチで元に戻せる。
 * - 退職（staff.remove）は、今日以降の担当と出勤を一緒に外す。退所（resident.remove）は対象者から外れる（リデューサ）。
 * - 等級・評価の項目は持たない（0011）。
 */

import type { Event } from "./events.ts";
import { metaOf, type EventContext } from "./pattern.ts";
import type { DateKey, ID, Resident, Staff, State } from "./types.ts";

export interface StaffInput {
  /** 直すときはその人の ID。足すときは無し */
  id?: ID;
  displayName: string;
  role: string;
  tags: string[];
  phone?: string;
}

export interface ResidentInput {
  id?: ID;
  displayName: string;
  groupId: ID;
  room: string;
}

export interface FormResult {
  events: Event[];
  /** トーストの文 */
  label: string;
  /** 入れられない理由（空なら入れられる） */
  error?: string;
}

const squash = (s: string) => s.replace(/[\s　]+/g, " ").trim();

/** 職員を足す／直す */
export function staffFormEvents(state: State, input: StaffInput, ctx: EventContext): FormResult {
  const displayName = squash(input.displayName);
  const role = squash(input.role);
  const phone = (input.phone ?? "").trim();
  if (!displayName) return { events: [], label: "", error: "名前を入れてください" };
  if (!role) return { events: [], label: "", error: "職種を入れてください（介護職員・介護助手・看護師・スポット など）" };
  if (phone && !/^[0-9-]+$/.test(phone)) return { events: [], label: "", error: `PHS「${phone}」は数字で書いてください` };
  const dup = Object.values(state.staff).find((s) => s.displayName === displayName && s.id !== input.id);
  if (dup) return { events: [], label: "", error: `${displayName}さんはすでに登録されています` };
  const prev = input.id ? state.staff[input.id] : undefined;
  if (input.id && !prev) return { events: [], label: "", error: "その職員は見つかりません" };
  const surname = displayName.split(" ")[0];
  const tags = [...new Set(input.tags.map((t) => t.trim()).filter(Boolean))];
  const staff: Staff = {
    ...(prev ?? { id: ctx.newId() }),
    id: prev?.id ?? ctx.newId(),
    displayName,
    surname,
    role,
    tags,
    ...(phone ? { phone } : {}),
  };
  if (!phone) delete (staff as { phone?: string }).phone;
  const label = prev ? `${surname}さんを直しました` : `${surname}さんを足しました（今日来るなら、ボードの右の「＋ 今日来る人を足す」から）`;
  return { events: [{ ...metaOf(ctx), type: "staff.upsert", staff }], label };
}

/** 退職: 今日以降の担当と出勤を外してから、職員を外す。元に戻すで全部戻る */
export function removeStaffEvents(state: State, staffId: ID, today: DateKey, ctx: EventContext): FormResult & { assignments: number; rosterDays: number } {
  const st = state.staff[staffId];
  if (!st) return { events: [], label: "", error: "その職員は見つかりません", assignments: 0, rosterDays: 0 };
  const events: Event[] = [];
  let assignments = 0;
  for (const a of Object.values(state.assignments)) {
    if (a.staffId !== staffId) continue;
    const task = state.tasks[a.taskId];
    if (!task || task.date < today) continue;
    events.push({ ...metaOf(ctx), type: "assignment.remove", id: a.id, taskId: a.taskId, staffId: a.staffId });
    assignments++;
  }
  let rosterDays = 0;
  for (const r of Object.values(state.roster)) {
    if (r.staffId !== staffId || r.date < today) continue;
    events.push({ ...metaOf(ctx), type: "roster.remove", id: r.id });
    rosterDays++;
  }
  events.push({ ...metaOf(ctx), type: "staff.remove", id: staffId });
  const extra = assignments > 0 ? `（今日以降の担当 ${assignments}件から外れました）` : "";
  return { events, label: `${st.surname}さんを退職にしました${extra}`, assignments, rosterDays };
}

/** 退職の前に知らせる数（今日以降の担当） */
export function staffFutureAssignments(state: State, staffId: ID, today: DateKey): number {
  return Object.values(state.assignments).filter((a) => a.staffId === staffId && (state.tasks[a.taskId]?.date ?? "") >= today).length;
}

/** 利用者を足す／直す */
export function residentFormEvents(state: State, input: ResidentInput, ctx: EventContext): FormResult {
  const displayName = squash(input.displayName);
  const room = input.room.trim();
  if (!displayName) return { events: [], label: "", error: "名前を入れてください" };
  const group = state.groups[input.groupId];
  if (!group || group.kind === "common") return { events: [], label: "", error: "グループを選んでください" };
  const dup = Object.values(state.residents).find((r) => r.displayName === displayName && r.groupId === input.groupId && r.id !== input.id);
  if (dup) return { events: [], label: "", error: `${displayName}様はすでに登録されています` };
  const prev = input.id ? state.residents[input.id] : undefined;
  if (input.id && !prev) return { events: [], label: "", error: "その方は見つかりません" };
  const surname = displayName.split(" ")[0];
  const resident: Resident = { id: prev?.id ?? ctx.newId(), displayName, surname, groupId: input.groupId, room };
  const label = prev ? `${surname}様を直しました` : `${surname}様を足しました（施設の日課が標準どおりに入ります）`;
  return { events: [{ ...metaOf(ctx), type: "resident.upsert", resident }], label };
}

/** 退所: 対象者から外れる（リデューサが外す）。元に戻すで対象にも戻る */
export function removeResidentEvents(state: State, residentId: ID, today: DateKey, ctx: EventContext): FormResult & { targets: number } {
  const r = state.residents[residentId];
  if (!r) return { events: [], label: "", error: "その方は見つかりません", targets: 0 };
  const targets = residentFutureTargets(state, residentId, today);
  const extra = targets > 0 ? `（今日以降の対象 ${targets}件から外れました）` : "";
  return { events: [{ ...metaOf(ctx), type: "resident.remove", id: residentId }], label: `${r.surname}様を退所にしました${extra}`, targets };
}

/** 退所の前に知らせる数（今日以降の、対象に入っている枠） */
export function residentFutureTargets(state: State, residentId: ID, today: DateKey): number {
  return Object.entries(state.targets).filter(([taskId, ids]) => ids.includes(residentId) && (state.tasks[taskId]?.date ?? "") >= today).length;
}
