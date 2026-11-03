/**
 * 全体（リーダーのスマホ）の純関数。docs/screens.md §4.1
 * - 画面は判定を持たない。行の並び・バッジ・候補・変わった行はここで決める。
 */

import type { Event } from "./events.ts";
import { applyEvents } from "./reducer.ts";
import { assigneesOf, headcountStatus, rankCandidates, rosterForDate, taskLabel, tasksForDate, tasksOfStaff, type Candidate } from "./checks.ts";
import { addDays } from "./pattern.ts";
import { fmtMin, fmtRange, overlaps } from "./time.ts";
import { residentLabel } from "./display.ts";
import { staffTaskName } from "./myday.ts";
import { MAX_MINUTES, type DateKey, type HeadcountStatus, type ID, type Minutes, type Resident, type RosterEntry, type Staff, type State, type TaskInstance } from "./types.ts";

/**
 * その人に［自分｜全体］を出すか。
 * - その日の番に leaderRank がある（施設がリーダーの番を決めている）
 * - 施設がリーダーの番をひとつも決めていなければ、出勤している人全員に出す
 */
export function canSeeAll(state: State, date: DateKey, staffId: ID): boolean {
  const entry = rosterForDate(state, date).find((e) => e.staffId === staffId && !e.absent);
  if (!entry) return false;
  const anyLeaderSlot = Object.values(state.roleSlots).some((s) => s.leaderRank !== undefined);
  if (!anyLeaderSlot) return true;
  return Boolean(entry.slotId && state.roleSlots[entry.slotId]?.leaderRank !== undefined);
}

export interface AllRow {
  task: TaskInstance;
  /** 「排泄介助 田中様」「入浴介助（東フロア）」。休憩は丸数字を外す */
  label: string;
  /** 一括の人数（「20人」）。個別は label に様名が入るので空 */
  count: string;
  assignees: Staff[];
  /** 充足の状態（休憩・中止の行ではバッジを出さない。unfilled を見る） */
  status: HeadcountStatus;
  /** 担当未定・担当あと n 人（休憩・中止は false） */
  unfilled: boolean;
  cancelled: boolean;
  isBreak: boolean;
  /** 時刻を過ぎた（終わりの時刻 ≤ いま）。完了とは言わない。並びはそのまま、薄く出すだけ */
  past: boolean;
}

/**
 * 時間順の一覧（中止も残す。開始 → 終わり → 名前の順）。
 * - 誰も入っていない休憩カードは出さない（休憩は埋める枠ではない）
 * - 時刻を過ぎた業務は「担当未定」に数えず、＋も出さない（これからの分だけを見る）
 */
export function allRows(state: State, date: DateKey, now: Minutes): AllRow[] {
  return tasksForDate(state, date, true)
    .filter((t) => t.kind !== "break" || assigneesOf(state, t.id).length > 0)
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin || a.name.localeCompare(b.name, "ja"))
    .map((task) => {
      const isBreak = task.kind === "break";
      const cancelled = task.status === "cancelled";
      const status = headcountStatus(state, task.id);
      const past = task.endMin <= now;
      const unfilled = !isBreak && !cancelled && !past && (status.level === "unassigned" || status.level === "short");
      const n = (state.targets[task.id] ?? []).length;
      return {
        task,
        label: isBreak ? staffTaskName(task) : taskLabel(state, task),
        count: task.targetMode === "group" && n > 0 ? `${n}人` : "",
        assignees: assigneesOf(state, task.id),
        status,
        unfilled,
        cancelled,
        isBreak,
        past,
      };
    });
}

/**
 * 夜勤明け: 前の業務日の夜勤帯の業務のうち、いま（この業務日の時刻）より後に終わるもの。
 * 夜勤帯の業務はその夜勤が始まった業務日に属する（data-model）ので、朝のリーダーの一覧には入らない。読み取り用に並べる。
 */
export function overnightRows(state: State, date: DateKey, now: Minutes): (AllRow & { timeText: string })[] {
  const prev = addDays(date, -1);
  return allRows(state, prev, now + 1440)
    .filter((r) => r.task.endMin > now + 1440 && !r.cancelled)
    .map((r) => {
      const s = r.task.startMin;
      const start = s >= 1440 ? fmtMin(s - 1440) : `前日 ${fmtMin(s)}`;
      return { ...r, timeText: `${start}–${fmtMin(r.task.endMin - 1440)}` };
    });
}

/** 見出しの「担当未定 2件」「担当あと 1 人 1件」の件数（これからの分）。押すと最初の該当行へ */
export function unfilledCount(rows: AllRow[]): number {
  return rows.filter((r) => r.unfilled).length;
}

/** 見出し用: ラベルごとの件数（担当未定 → 担当あと n 人の n が小さい順）。これからの分だけ */
export function unfilledGroups(rows: AllRow[]): { label: string; level: "unassigned" | "short"; count: number }[] {
  const map = new Map<string, { label: string; level: "unassigned" | "short"; count: number; gap: number }>();
  for (const r of rows) {
    if (!r.unfilled) continue;
    const level = r.status.level === "unassigned" ? "unassigned" : "short";
    const cur = map.get(r.status.label) ?? { label: r.status.label, level, count: 0, gap: level === "unassigned" ? -1 : r.status.gap };
    cur.count++;
    map.set(r.status.label, cur);
  }
  return [...map.values()].sort((a, b) => a.gap - b.gap).map(({ label, level, count }) => ({ label, level, count }));
}

/** 「● いまの時間」を差し込む位置（始まりがいまより後の最初の行。いま行っている業務はその上に並ぶ） */
export function firstUpcomingIndex(rows: AllRow[], now: Minutes): number {
  return rows.findIndex((r) => r.task.startMin > now);
}

/**
 * 業務を delta 分ずらす前の確かめ（休憩以外）。
 * - その日の時間割（0:00〜翌 23:59）の外へは出さない（日をまたぐ移動は作らない）
 * - 担当の人のほかの予定と重なるなら、その一文を返す（止めない。トーストに添える）
 */
export function shiftCheck(state: State, taskId: ID, delta: Minutes): { ok: boolean; message?: string; conflicts: string[] } {
  const t = state.tasks[taskId];
  if (!t) return { ok: false, message: "業務が見つかりません", conflicts: [] };
  const s = t.startMin + delta;
  const e = t.endMin + delta;
  if (s < 0 || e > MAX_MINUTES - 1) return { ok: false, message: "その日の時間割の外へはずらせません", conflicts: [] };
  const conflicts: string[] = [];
  for (const a of assigneesOf(state, taskId)) {
    for (const o of tasksOfStaff(state, t.date, a.id)) {
      if (o.id === taskId || !overlaps(s, e, o.startMin, o.endMin)) continue;
      conflicts.push(`${a.surname}さんは「${o.kind === "break" ? "休憩" : taskLabel(state, o)} ${fmtRange(o.startMin, o.endMin)}」と重なります`);
    }
  }
  return { ok: true, conflicts };
}

/** 早退の時刻（15分切り上げ。勤務の始まりより前にはしない） */
export function leaveAt(entry: RosterEntry, now: Minutes): Minutes {
  return Math.max(Math.ceil(now / 15) * 15, entry.startMin);
}

/** イベントで変わる業務（決定後に一覧で3秒強調する行） */
export function touchedTaskIds(before: State, events: Event[]): ID[] {
  const ids = new Set<ID>();
  for (const ev of events) {
    if (ev.type === "task.add") ids.add(ev.task.id);
    else if (ev.type === "task.update" || ev.type === "task.setTargets") ids.add(ev.id);
    else if (ev.type === "assignment.add") ids.add(ev.assignment.taskId);
    else if (ev.type === "assignment.remove") {
      const a = before.assignments[ev.id];
      if (a) ids.add(a.taskId);
    }
  }
  return [...ids];
}

/** 欠勤・早退で選べる人（その日に出勤予定で、まだ欠勤にしていない人）。番の並び順 */
export function absenceChoices(state: State, date: DateKey): { entry: RosterEntry; staff: Staff; slotName: string }[] {
  const order = (id?: ID) => (id ? (state.roleSlots[id]?.sortOrder ?? 999) : 999);
  return rosterForDate(state, date)
    .filter((e) => !e.absent && state.staff[e.staffId])
    .sort((a, b) => order(a.slotId) - order(b.slotId) || a.startMin - b.startMin)
    .map((entry) => ({ entry, staff: state.staff[entry.staffId], slotName: entry.slotId ? (state.roleSlots[entry.slotId]?.name ?? "") : "" }));
}

/** 欠勤か早退か（勤務前＝欠勤、勤務中＝早退）。absencePreview と同じ決め方 */
export function absenceKind(entry: RosterEntry, now: Minutes): "欠勤" | "早退" | "勤務後" {
  if (now >= entry.endMin) return "勤務後";
  return now > entry.startMin ? "早退" : "欠勤";
}

/** 付き添いで選べる利用者（グループの並び → 部屋番号）。表示名は施設の設定に従う */
export function escortChoices(state: State): { resident: Resident; label: string; groupName: string }[] {
  const mode = state.facility?.settings.residentDisplayMode ?? "roomAndSurname";
  const gOrder = (id: ID) => state.groups[id]?.sortOrder ?? 999;
  return Object.values(state.residents)
    .slice()
    .sort((a, b) => gOrder(a.groupId) - gOrder(b.groupId) || a.room.localeCompare(b.room, "ja", { numeric: true }))
    .map((resident) => ({ resident, label: `${residentLabel(resident, mode)}様`, groupName: state.groups[resident.groupId]?.name ?? "" }));
}

/** 付き添いの名前に合う業務の種類（手順・物品・相談先を引き継ぐ） */
export function escortTemplateId(state: State, name: string): ID | undefined {
  return Object.values(state.templates).find((t) => t.name === name && t.targetMode === "individual")?.id;
}

/**
 * まだ足していない業務（プレビューのイベント）に付けられる人。
 * プレビューを仮に当てた状態で、ボードの「＋」と同じ並び（問題なし → 注意 → 勤務外）にする。
 */
export function candidatesForPreview(state: State, events: Event[], taskId: ID): Candidate[] {
  const after = applyEvents(state, events);
  return rankCandidates(after, taskId);
}
