/**
 * 表示用の純関数。文言の規則はここに集める。
 */

import type { Resident, ResidentDisplayMode, State, TaskInstance, TaskTemplate } from "./types.ts";

/** 手元画面での利用者の表示名。ボード（施設PC）は常に full */
export function residentLabel(r: Resident, mode: ResidentDisplayMode): string {
  switch (mode) {
    case "full":
      return `${r.displayName}`;
    case "roomAndSurname":
      return `${r.room} ${r.surname}`;
    case "roomOnly":
      return r.room;
  }
}

/** 対象の種類の短い表示: 「一括 20人」「個別 田中様」「共通」 */
export function targetChip(state: State, task: TaskInstance): string {
  const ids = state.targets[task.id] ?? [];
  if (task.kind === "break") return "休憩";
  if (task.targetMode === "none") return "共通";
  if (task.targetMode === "individual") {
    const r = ids[0] ? state.residents[ids[0]] : undefined;
    return r ? `個別 ${r.surname}様` : "個別";
  }
  return `一括 ${ids.length}人`;
}

export function categoryName(state: State, categoryId?: string): string {
  if (!categoryId) return "";
  return state.facility?.settings.categories.find((c) => c.id === categoryId)?.name ?? "";
}

export function templateSummary(tpl: TaskTemplate): string {
  const target = tpl.targetMode === "individual" ? "個別" : tpl.targetMode === "group" ? "一括" : "共通";
  return `${tpl.name}（${target}・${tpl.defaultDurationMin}分・${tpl.defaultHeadcount}人）`;
}

/** 見出しに出す更新時刻。名前は出さない（履歴で見る） */
export function updatedAtLabel(iso: string | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const sameDay = d.toDateString() === now.toDateString();
  const hh = d.getHours();
  const mm = d.getMinutes().toString().padStart(2, "0");
  return sameDay ? `更新 ${hh}:${mm}` : `更新 ${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}
