/**
 * 自分の予定（スマホ）と業務詳細の計算。純関数。docs/screens.md §4・§5
 *
 * 文言の規則:
 * - 見出しは「いまの時間の予定」。時刻が過ぎても「実施中」「完了」にしない。示すのは人が付けた「終わった」の印だけ（決定記録 0010）。
 * - 職員の画面に仕組みの言葉（一括・共通・コア・ノンコア・役割枠・型）と充足バッジを出さない。
 * - 利用者名は施設の設定（既定: 部屋番号＋姓）。
 */

import { assigneesOf, canMarkDone, checkAssignment, headcountStatus, isWatchTask, rosterOf, taskLabel, tasksForDate, tasksOfStaff } from "./checks.ts";
import { residentLabel } from "./display.ts";
import { addDays } from "./pattern.ts";
import { sheetRowFor } from "./routine.ts";
import type { DateKey, ID, Minutes, RosterEntry, Staff, State, TaskInstance } from "./types.ts";

import { businessMinutes, fmtMin } from "./time.ts";
export { businessMinutes };

/**
 * 見ている人にとっての業務日の時刻。夜勤（17:00–翌9:00 など）の人は、勤務の始まる前の朝の時刻を「翌」として読む
 * （夜勤明けの 翌6:00–翌9:00 の予定が出るように）。それ以外の人は businessMinutes と同じ。
 * 既に業務日の分（1440 以上。デモの ?now=30:30 など）ならそのまま。
 */
/**
 * 見ている人の業務日と時刻。夜勤帯の業務はその夜勤が始まった業務日に属する（data-model）ので、
 * 前の業務日の勤務（翌9:00 まで など）の中にいる人は、前の業務日を開く（今日の勤務表より優先）。
 * それ以外は date のまま、時刻は viewerMinutes。
 */
export function viewerDay(state: State, date: DateKey, staffId: ID | null, clockMin: Minutes): { date: DateKey; now: Minutes } {
  if (staffId && clockMin < 24 * 60) {
    const prev = addDays(date, -1);
    const e = rosterOf(state, prev, staffId);
    const at = clockMin + 24 * 60;
    if (e && !e.absent && e.endMin > 24 * 60 && e.startMin <= at && at < e.endMin) return { date: prev, now: at };
  }
  return { date, now: viewerMinutes(state, date, staffId, clockMin) };
}

export function viewerMinutes(state: State, date: string, staffId: ID | null, clockMin: Minutes): Minutes {
  if (clockMin >= 24 * 60) return clockMin;
  const e = staffId ? rosterOf(state, date, staffId) : undefined;
  const night = clockMin + 24 * 60;
  if (e && !e.absent && clockMin < e.startMin && e.startMin <= night && night < e.endMin) return night;
  return businessMinutes(clockMin);
}

export interface ContactPerson {
  staffId: ID;
  surname: string;
  phone?: string;
}

export interface LeaderContact {
  leader: ContactPerson;
  /** 施設がリーダーの番（leaderRank）を決めていて、その番の人か。違えば「（リーダー）」と書かず番の名前で出す */
  isLeader: boolean;
  slotName: string;
  /** リーダーが休憩中なら、その休憩の時刻と代わりの人 */
  onBreak?: { startMin: Minutes; endMin: Minutes };
  substitute?: ContactPerson;
  /** リーダー本人が困ったときの次の相談先（勤務中で、リーダーの番の次に順の人）。いなければ undefined */
  next?: ContactPerson & { slotName: string };
}

const person = (s: Staff): ContactPerson => ({ staffId: s.id, surname: s.surname, phone: s.phone });

/** その時刻に休憩カードの担当になっているか。なっていればその休憩 */
export function breakAt(state: State, date: string, staffId: ID, now: Minutes): TaskInstance | undefined {
  return tasksOfStaff(state, date, staffId).find((t) => t.kind === "break" && t.startMin <= now && now < t.endMin);
}

interface OnDuty {
  entry: RosterEntry;
  /** その勤務の業務日での時刻（前の業務日の夜勤なら +1440） */
  at: Minutes;
  rank?: number;
  order: number;
  onBreak?: TaskInstance;
}

/** その時刻に勤務中の人。前の業務日の夜勤（翌9:00 まで など）と、翌朝（now が 1440 以上）なら次の日の早番も入れる */
function onDutyAt(state: State, date: string, now: Minutes): OnDuty[] {
  const out: OnDuty[] = [];
  const prev = addDays(date, -1);
  const next = addDays(date, 1);
  for (const e of Object.values(state.roster)) {
    if (e.absent || !state.staff[e.staffId]) continue;
    const at = e.date === date ? now : e.date === prev ? now + 24 * 60 : e.date === next && now >= 24 * 60 ? now - 24 * 60 : undefined;
    if (at === undefined || !(e.startMin <= at && at < e.endMin)) continue;
    const slot = e.slotId ? state.roleSlots[e.slotId] : undefined;
    out.push({ entry: e, at, rank: slot?.leaderRank, order: slot?.sortOrder ?? 999, onBreak: breakAt(state, e.date, e.staffId, at) });
  }
  return out;
}

/**
 * 「困ったら」の相談先（決定記録 0006）。
 * - その時刻に勤務中で、番の leaderRank がいちばん小さい人（前の業務日の夜勤も見る）。
 * - 施設がリーダーの番を決めていない、またはリーダーの番の人が誰も勤務中でないときは、勤務中の人を番の並び順で（「リーダー」とは書かない）。
 * - 勤務中の人がいなければ undefined（画面は「近くの職員へ」）。
 * - 休憩中なら、勤務中で休憩中でない人を同じ順で代わりにする。
 */
export function leaderContact(state: State, date: string, now: Minutes): LeaderContact | undefined {
  const duty = onDutyAt(state, date, now);
  const byRank = duty.filter((d) => d.rank !== undefined).sort((a, b) => a.rank! - b.rank! || a.order - b.order);
  const byOrder = [...duty].sort((a, b) => a.order - b.order || a.entry.startMin - b.entry.startMin);
  const primary = byRank[0] ?? byOrder[0];
  if (!primary) return undefined;
  const leaderStaff = state.staff[primary.entry.staffId];
  // リーダー本人の相談先は、リーダーの番（leaderRank）の人だけから（同僚ではなく、次の順の人）
  const nextDuty = byRank.find((d) => d !== primary);
  const base = {
    leader: person(leaderStaff),
    isLeader: primary.rank !== undefined,
    slotName: primary.entry.slotId ? (state.roleSlots[primary.entry.slotId]?.name ?? "") : "",
    next: nextDuty ? { ...person(state.staff[nextDuty.entry.staffId]), slotName: nextDuty.entry.slotId ? (state.roleSlots[nextDuty.entry.slotId]?.name ?? "") : "" } : undefined,
  };
  if (!primary.onBreak) return base;
  const sub = [...byRank, ...byOrder].find((d) => d !== primary && !d.onBreak);
  return {
    ...base,
    onBreak: { startMin: primary.onBreak.startMin - (primary.at - now), endMin: primary.onBreak.endMin - (primary.at - now) },
    substitute: sub ? person(state.staff[sub.entry.staffId]) : undefined,
  };
}

/**
 * 一日の相談先の移り変わり（印刷用）。「7:00–16:00 佐藤 ／ 16:00–20:00 木村 …」
 * 15分ごとに見て、同じ人が続く間をまとめる（休憩の代わりは入れない）
 */
export function leaderSchedule(state: State, date: string, from: Minutes, to: Minutes): { startMin: Minutes; endMin: Minutes; contact: LeaderContact }[] {
  const out: { startMin: Minutes; endMin: Minutes; contact: LeaderContact }[] = [];
  for (let t = from; t < to; t += 15) {
    const c = leaderContact(state, date, t);
    if (!c) continue;
    const last = out[out.length - 1];
    if (last && last.contact.leader.staffId === c.leader.staffId && last.endMin === t) last.endMin = t + 15;
    else out.push({ startMin: t, endMin: t + 15, contact: { ...c, onBreak: undefined, substitute: undefined } });
  }
  return out;
}

/** 職員の画面での業務名（休憩の丸数字を外す） */
export function staffTaskName(task: TaskInstance): string {
  return task.kind === "break" ? task.name.replace(/[①-⑳]/g, "") : task.name;
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
  /** 時刻が過ぎた（それだけでは「終わった」にしない。濃さも変えない） */
  past: boolean;
  /** 「終わった」の印（人が付けたもの。時刻が過ぎただけでは付かない） */
  done: boolean;
  /** 印を付けられる枠か（休憩・中止・見守りは付けない） */
  canDone: boolean;
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
  // 休憩の丸数字（休憩①②③）はボードで波を見分けるための番号。職員の画面では「休憩」とだけ出す
  let title = isBreak ? staffTaskName(task) : task.name;
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
    done: Boolean(task.done),
    canDone: canMarkDone(task),
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
  const all: TargetLine[] = ids
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
  // 時刻が違う方 → サポートの1行がある方 → 部屋番号の順（6人で切っても大事な方が隠れないように）
  const rank = (l: TargetLine) => (l.timeMin !== undefined ? 0 : l.support ? 1 : 2);
  const room = (id: ID) => state.residents[id]?.room ?? "";
  all.sort((a, b) => rank(a) - rank(b) || room(a.residentId).localeCompare(room(b.residentId), "ja", { numeric: true }));
  const lines = all.slice(0, limit);
  return { lines, more: all.length - lines.length, supportShown };
}

/** 手が空いたら（決定記録 0021）: 勤務中の 30 分以上の空きと、その時間に始まり自分が入っても注意の出ない枠の名前（3 件まで） */
export interface FreeGap {
  startMin: Minutes;
  endMin: Minutes;
  /** 手伝える仕事の名前（担当がまだ足りない枠のうち、時間内・条件を満たし注意の出ないもの）。札・件数は持たない */
  helpable: string[];
  /** 夜勤の番の人の空き（手伝える仕事の名前を出さない） */
  night?: boolean;
}

export function freeGaps(state: State, date: string, staffId: ID, minLength = 30, nowMin?: Minutes | null): FreeGap[] {
  const entry = rosterOf(state, date, staffId);
  if (!entry || entry.absent) return [];
  const mine = tasksOfStaff(state, date, staffId).sort((a, b) => a.startMin - b.startMin);
  const gaps: { startMin: Minutes; endMin: Minutes }[] = [];
  let cursor = entry.startMin;
  for (const t of mine) {
    if (t.startMin - cursor >= minLength) gaps.push({ startMin: cursor, endMin: t.startMin });
    cursor = Math.max(cursor, t.endMin);
  }
  if (entry.endMin - cursor >= minLength) gaps.push({ startMin: cursor, endMin: entry.endMin });
  // 夜勤の番の人には空きの行を出さない（予定の枠が無くても、フロアでコールに応じている時間。ループ 21）
  const night = entry.endMin > 24 * 60;
  if (night) return [];
  // 自分の番（なければ所属）のグループと、共通の枠だけ（別のフロアへの案内にしない）
  const myGroup = (entry.slotId ? state.roleSlots[entry.slotId]?.groupId : undefined) ?? state.staff[staffId]?.homeGroupId;
  const inMyArea = (t: TaskInstance) => !t.groupId || state.groups[t.groupId]?.kind === "common" || !myGroup || t.groupId === myGroup;
  const now = nowMin === null || nowMin === undefined ? undefined : businessMinutes(nowMin);
  const all = tasksForDate(state, date);
  return gaps.map((g) => {
    const helpable = night
      ? []
      : all
          .filter((t) => t.kind !== "break" && !isWatchTask(t) && !t.done && inMyArea(t) && t.startMin >= g.startMin && t.startMin < g.endMin && t.endMin <= g.endMin)
          .filter((t) => now === undefined || t.startMin >= now)
          .filter((t) => {
            const l = headcountStatus(state, t.id).level;
            return (l === "unassigned" || l === "short") && checkAssignment(state, t.id, staffId).length === 0;
          })
          .slice(0, 3)
          .map((t) => `${fmtMin(t.startMin)} ${taskLabel(state, t)}`);
    return { ...g, helpable, night };
  });
}
