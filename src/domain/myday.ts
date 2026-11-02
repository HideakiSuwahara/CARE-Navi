/**
 * 自分の予定（スマホ）と業務詳細の計算。純関数。docs/screens.md §4・§5
 *
 * 文言の規則:
 * - 見出しは「いまの時間の予定」。時刻が過ぎても「実施中」「完了」にしない（過ぎた予定は薄く出すだけ）。
 * - 職員の画面に仕組みの言葉（一括・共通・コア・ノンコア・役割枠・型）と充足バッジを出さない。
 * - 利用者名は施設の設定（既定: 部屋番号＋姓）。
 */

import { assigneesOf, rosterOf, tasksOfStaff } from "./checks.ts";
import { residentLabel } from "./display.ts";
import { sheetRowFor } from "./routine.ts";
import type { ID, Minutes, RosterEntry, Staff, State, TaskInstance } from "./types.ts";

/** 時計の分（0–1439）を業務日の分へ。6:00 より前は前の日の夜勤帯（翌0:00〜翌6:00） */
export function businessMinutes(clockMin: Minutes): Minutes {
  return clockMin < 6 * 60 ? clockMin + 24 * 60 : clockMin;
}

export interface ContactPerson {
  staffId: ID;
  surname: string;
  phone?: string;
}

export interface LeaderContact {
  leader: ContactPerson;
  /** リーダーが休憩中なら、その休憩の時刻と代わりの人 */
  onBreak?: { startMin: Minutes; endMin: Minutes };
  substitute?: ContactPerson;
}

const person = (s: Staff): ContactPerson => ({ staffId: s.id, surname: s.surname, phone: s.phone });

const onDuty = (e: RosterEntry, now: Minutes) => !e.absent && e.startMin <= now && now < e.endMin;

/** その時刻に休憩カードの担当になっているか。なっていればその休憩 */
export function breakAt(state: State, date: string, staffId: ID, now: Minutes): TaskInstance | undefined {
  return tasksOfStaff(state, date, staffId).find((t) => t.kind === "break" && t.startMin <= now && now < t.endMin);
}

/**
 * 「困ったら」の相談先。番の leaderRank の小さい順に、その時刻に勤務中の人（leaderRank がどの番にもなければ番の並び順）。
 * 勤務中の人がいなければ（朝の早い時刻など）、いちばん小さい番の人。
 * 休憩中なら、次の番で勤務中・休憩中でない人を代わりにする。
 */
export function leaderContact(state: State, date: string, now: Minutes): LeaderContact | undefined {
  const today = Object.values(state.roster).filter((e) => e.date === date && !e.absent && e.slotId && state.roleSlots[e.slotId]);
  const rank = (e: RosterEntry) => state.roleSlots[e.slotId!]!.leaderRank;
  // リーダーの番が決まっていない施設では、番の並び順（早番A が先）で見る
  const ranked = today.filter((e) => rank(e) !== undefined);
  const entries = ranked.length > 0
    ? ranked.sort((a, b) => rank(a)! - rank(b)!)
    : today.sort((a, b) => state.roleSlots[a.slotId!]!.sortOrder - state.roleSlots[b.slotId!]!.sortOrder);
  if (entries.length === 0) return undefined;
  const primary = entries.find((e) => onDuty(e, now)) ?? entries[0];
  const leaderStaff = state.staff[primary.staffId];
  if (!leaderStaff) return undefined;
  const brk = breakAt(state, date, primary.staffId, now);
  if (!brk) return { leader: person(leaderStaff) };
  const sub = entries.find((e) => e !== primary && onDuty(e, now) && !breakAt(state, date, e.staffId, now));
  const subStaff = sub ? state.staff[sub.staffId] : undefined;
  return {
    leader: person(leaderStaff),
    onBreak: { startMin: brk.startMin, endMin: brk.endMin },
    substitute: subStaff ? person(subStaff) : undefined,
  };
}

export interface MyItem {
  task: TaskInstance;
  /** 業務名（個別は「排泄介助 203 田中様」） */
  title: string;
  /** 対象の短い表示: 「東フロア 20人」「203 田中様」。対象なし・休憩は空 */
  target: string;
  /** 一緒に入る人（自分を除く） */
  together: ContactPerson[];
  isBreak: boolean;
  /** 時刻が過ぎた（薄く出すだけ。完了ではない） */
  past: boolean;
  /** いまの時間の予定 */
  current: boolean;
}

export type FocusMode = "now" | "first" | "next" | "after";

export interface MyDay {
  staff: Staff;
  entry: RosterEntry;
  slotName: string;
  items: MyItem[];
  /** 大きく出す予定（いまの時間の予定／最初の予定／つぎ） */
  focus: MyItem[];
  focusMode: FocusMode;
  /** focus の次（「つぎ」として同じ大きさで出す）。focusMode が now・first のとき */
  upcoming?: MyItem;
}

function itemOf(state: State, task: TaskInstance, staffId: ID, now: Minutes): MyItem {
  const mode = state.facility?.settings.residentDisplayMode ?? "roomAndSurname";
  const ids = state.targets[task.id] ?? [];
  const isBreak = task.kind === "break";
  let title = task.name;
  let target = "";
  if (task.targetMode === "individual" && ids[0] && state.residents[ids[0]]) {
    title = `${task.name} ${residentLabel(state.residents[ids[0]], mode)}様`;
  } else if (task.targetMode === "group" && ids.length > 0) {
    const g = task.groupId ? state.groups[task.groupId] : undefined;
    target = `${g && g.kind !== "common" ? `${g.name} ` : ""}${ids.length}人`;
  }
  return {
    task,
    title,
    target,
    // 休憩は一緒に入る業務ではないので出さない
    together: isBreak
      ? []
      : assigneesOf(state, task.id)
          .filter((s) => s.id !== staffId)
          .map(person),
    isBreak,
    past: task.endMin <= now,
    current: task.startMin <= now && now < task.endMin,
  };
}

/** その人のきょうの予定。出勤していなければ undefined */
export function myDay(state: State, date: string, staffId: ID, now: Minutes): MyDay | undefined {
  const staff = state.staff[staffId];
  const entry = rosterOf(state, date, staffId);
  if (!staff || !entry || entry.absent) return undefined;
  const items = tasksOfStaff(state, date, staffId).map((t) => itemOf(state, t, staffId, now));
  const current = items.filter((i) => i.current);
  let focus: MyItem[] = [];
  let focusMode: FocusMode = "after";
  let upcoming: MyItem | undefined;
  if (current.length > 0) {
    focus = current;
    focusMode = "now";
    upcoming = items.find((i) => !i.current && i.task.startMin > now);
  } else if (now < entry.startMin && items.length > 0) {
    focus = [items[0]];
    focusMode = "first";
    upcoming = items[1];
  } else {
    const next = items.find((i) => i.task.startMin > now);
    if (next) {
      focus = [next];
      focusMode = "next";
    }
  }
  return {
    staff,
    entry,
    slotName: entry.slotId ? (state.roleSlots[entry.slotId]?.name ?? "") : "",
    items,
    focus,
    focusMode,
    upcoming,
  };
}

export interface TargetLine {
  residentId: ID;
  label: string;
  /** 枠の中で時刻が違う方の時刻 */
  timeMin?: Minutes;
  /** 24時間シートの「サポートが必要なこと」。担当の人に、勤務時間中だけ出す */
  support?: string;
}

/**
 * 業務詳細の「対象の方」。6人まで出して「ほか n 人」（screens.md §5）。
 * サポートの1行は、見ている人がその業務の担当で、いま勤務時間中のときだけ出す（決定記録 0004 §4）。
 */
export function targetLines(
  state: State,
  task: TaskInstance,
  viewerId: ID | undefined,
  now: Minutes,
  limit = 6,
): { lines: TargetLine[]; more: number; supportShown: boolean } {
  const mode = state.facility?.settings.residentDisplayMode ?? "roomAndSurname";
  const ids = state.targets[task.id] ?? [];
  const isAssignee = viewerId !== undefined && assigneesOf(state, task.id).some((s) => s.id === viewerId);
  const entry = viewerId ? rosterOf(state, task.date, viewerId) : undefined;
  const supportShown = Boolean(isAssignee && entry && !entry.absent && entry.startMin <= now && now < entry.endMin);
  const all = ids
    .map((rid) => state.residents[rid])
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .map((r) => {
      const row = task.routineId ? sheetRowFor(state, r.id, task.routineId) : undefined;
      return {
        residentId: r.id,
        label: residentLabel(r, mode),
        timeMin: task.targetTimes?.[r.id],
        support: supportShown ? row?.support || undefined : undefined,
      };
    });
  const lines = all.slice(0, limit);
  return { lines, more: all.length - lines.length, supportShown };
}
