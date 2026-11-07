/**
 * ボードの配置計算（純関数）。
 * 同じ列で時間が重なるカードは横に並べる（カレンダーの日表示と同じ考え方）。
 * - 重なりでつながったカードの塊（クラスタ）ごとに、最小の段数で詰める。
 * - 長い継続業務（見守り）は左の段に寄るよう、開始が早く長いものから置く。
 */

import type { ID, Minutes, Resident, State, TaskInstance } from "./types.ts";
import { assigneesOf, boardName, headcountLabel, isWatchTask, taskLabel, tasksForDate } from "./checks.ts";

export { isWatchTask };

export interface LaidOutCard {
  task: TaskInstance;
  /** 0 始まりの段 */
  lane: number;
  /** その塊の段数（幅 = 1 / lanes） */
  lanes: number;
  /** 見守りのような長い継続業務は、列の左の細い帯（レール）に置く */
  rail?: boolean;
}

/** レールに置く長さ（分）。2時間以上の業務 */
export const RAIL_MIN_DURATION = 120;

/**
 * @param minVisualMin 画面上の最小の長さ（分）。短い業務もこの長さを占めるものとして重なりを判定する
 *   （15分の業務の下に次の業務がくっついて描かれ、文字やボタンが重ならないように）
 */
export function layoutColumn(tasks: TaskInstance[], minVisualMin = 0): LaidOutCard[] {
  const vEnd = (t: TaskInstance) => Math.max(t.endMin, t.startMin + minVisualMin);
  const sorted = [...tasks].sort(
    (a, b) => a.startMin - b.startMin || b.endMin - b.startMin - (a.endMin - a.startMin) || a.id.localeCompare(b.id),
  );
  const out: LaidOutCard[] = [];
  let cluster: { card: LaidOutCard; end: Minutes }[] = [];
  let clusterEnd = -1;
  let laneEnds: Minutes[] = [];

  const flush = () => {
    const lanes = Math.max(1, laneEnds.length);
    for (const c of cluster) c.card.lanes = lanes;
    cluster = [];
    laneEnds = [];
  };

  for (const task of sorted) {
    if (cluster.length > 0 && task.startMin >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= task.startMin);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(vEnd(task));
    } else {
      laneEnds[lane] = vEnd(task);
    }
    const card: LaidOutCard = { task, lane, lanes: 1 };
    out.push(card);
    cluster.push({ card, end: vEnd(task) });
    clusterEnd = Math.max(cluster.length === 1 ? vEnd(task) : clusterEnd, vEnd(task));
  }
  flush();
  return out;
}

export interface BoardColumn {
  /** グループ ID。グループ未設定の業務は "common" 列へ */
  id: ID;
  name: string;
  sub: string;
  cards: LaidOutCard[];
  /** レール（左の細い帯）を持つか */
  hasRail: boolean;
  /** レールの外で、同じ時刻に横に並ぶカードの最大数（列の最小幅の計算に使う） */
  maxLanes: number;
}

/**
 * 列の配置。休憩以外で2時間以上の業務（見守りなど）は左のレールへ、それ以外は残りの幅で横に並べる。
 */
export function layoutGroupColumn(tasks: TaskInstance[], minVisualMin = 0): { cards: LaidOutCard[]; hasRail: boolean; maxLanes: number } {
  const isRail = (t: TaskInstance) => t.kind !== "break" && t.endMin - t.startMin >= RAIL_MIN_DURATION;
  const railTasks = tasks.filter(isRail);
  const rest = tasks.filter((t) => !isRail(t));
  const rail = layoutColumn(railTasks, minVisualMin).map((c) => ({ ...c, rail: true }));
  const others = layoutColumn(rest, minVisualMin);
  return { cards: [...rail, ...others], hasRail: rail.length > 0, maxLanes: Math.max(1, ...others.map((c) => c.lanes)) };
}

/** ボードの列（グループ順）。共通（common）は最後。中止した業務は出さない */
export function boardColumns(state: State, date: string, minVisualMin = 0, groupId?: ID): BoardColumn[] {
  // 見るグループ（決定記録 0017）: 選んだグループと共通の列だけ
  const groups = Object.values(state.groups)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .filter((g) => !groupId || !state.groups[groupId] || g.id === groupId || g.kind === "common");
  const common = groups.find((g) => g.kind === "common");
  const tasks = tasksForDate(state, date);
  const byGroup = new Map<ID, TaskInstance[]>();
  for (const t of tasks) {
    const g = t.groupId && state.groups[t.groupId] ? t.groupId : (common?.id ?? "common");
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g)!.push(t);
  }
  const residentsIn = (gid: ID) => Object.values(state.residents).filter((r) => r.groupId === gid).length;
  return groups.map((g) => {
    const { cards, hasRail, maxLanes } = layoutGroupColumn(byGroup.get(g.id) ?? [], minVisualMin);
    return {
      id: g.id,
      name: g.name,
      // 足したばかりで利用者がいないグループは、次の 1 手を添える（ループ 13 #19）
      sub: g.kind === "common" ? "" : residentsIn(g.id) === 0 ? "利用者がまだいません（利用者の画面で足せます）" : `利用者 ${residentsIn(g.id)}人`,
      cards,
      hasRail,
      maxLanes,
    };
  });
}

/**
 * 横軸［利用者］（決定記録 0017）: 選んだグループの方を部屋の順に列にし、その方が対象の枠を置く。
 * - 個別の枠と、その方が入っている一括の枠。一括の枠は方ごとの列に同じ 1 枚が出る（担当は枠に付く）。
 * - 利用者に付いていない枠（見守り・共通・休憩）は出さない。
 */
export function residentColumns(state: State, date: string, groupId: ID, label: (r: Resident) => string, minVisualMin = 0): BoardColumn[] {
  const residents = Object.values(state.residents)
    .filter((r) => r.groupId === groupId)
    .sort((a, b) => a.room.localeCompare(b.room, "ja", { numeric: true }) || a.displayName.localeCompare(b.displayName, "ja"));
  // 休憩・見守り・共通の枠は出さない（決定記録 0017 §3）
  const tasks = tasksForDate(state, date).filter((t) => t.kind !== "break" && !isWatchTask(t) && !(t.groupId && state.groups[t.groupId]?.kind === "common"));
  return residents.map((r) => {
    const mine = tasks.filter((t) => (state.targets[t.id] ?? []).includes(r.id));
    const { cards, hasRail, maxLanes } = layoutGroupColumn(mine, minVisualMin);
    return { id: r.id, name: `${label(r)}様`, sub: r.displayName, cards, hasRail, maxLanes };
  });
}

/**
 * 横軸［利用者］で、既定で選ぶグループ。選んでいるグループに利用者がいればそれ、
 * なければ利用者のいる最初のユニット（利用者ごとに見たいのはユニットが多い）、なければ利用者のいる最初のグループ。
 */
export function residentViewGroup(state: State, groupId?: ID): ID | undefined {
  const has = (gid: ID) => Object.values(state.residents).some((r) => r.groupId === gid);
  if (groupId && state.groups[groupId] && has(groupId)) return groupId;
  const list = Object.values(state.groups)
    .filter((g) => g.kind !== "common" && has(g.id))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  return (list.find((g) => g.kind === "unit") ?? list[0])?.id;
}

// ---------------------------------------------------------------------------
// 右パレット「きょうの出勤者」（件数・予定時間は出さない。決定記録 0003 §4）
// ---------------------------------------------------------------------------

export interface PaletteRow {
  staffId: ID;
  surname: string;
  slotName: string;
  startMin: Minutes;
  endMin: Minutes;
  firstTimer: boolean;
  /** 休みの種類（公休・有休 など。決定記録 0024） */
  offKind?: string;
  /** 休みの人の番に束ねた枠のうち、未充足の件数（休みの欄に「介護助手の枠: 担当未定 2・担当あと1人 1」。人には数字を付けない） */
  unfilledSlotTasks: number;
  /** その内訳（実際の文言ごと。例: [{label:"担当未定",count:2},{label:"担当あと1人",count:1}]） */
  slotTaskLabels: { label: string; count: number }[];
}

export function paletteRows(state: State, date: string): { working: PaletteRow[]; off: PaletteRow[] } {
  const entries = Object.values(state.roster).filter((e) => e.date === date);
  const slotOrder = (id?: ID) => (id ? (state.roleSlots[id]?.sortOrder ?? 999) : 999);
  entries.sort((a, b) => slotOrder(a.slotId) - slotOrder(b.slotId) || a.startMin - b.startMin);
  const tasks = tasksForDate(state, date);
  const assigned = (taskId: ID) => Object.values(state.assignments).filter((a) => a.taskId === taskId).length;
  const working: PaletteRow[] = [];
  const off: PaletteRow[] = [];
  for (const e of entries) {
    const staff = state.staff[e.staffId];
    if (!staff) continue;
    const mine = e.absent
      ? tasks.filter((t) => t.kind !== "break" && e.slotId && t.slotIds.includes(e.slotId) && assigned(t.id) < t.headcount)
      : [];
    const row: PaletteRow = {
      staffId: staff.id,
      surname: boardName(state, staff.id),
      slotName: e.slotId ? (state.roleSlots[e.slotId]?.name ?? "") : "",
      startMin: e.startMin,
      endMin: e.endMin,
      firstTimer: e.firstTimer,
      ...(e.absent && e.offKind ? { offKind: e.offKind } : {}),
      unfilledSlotTasks: mine.length,
      slotTaskLabels: Object.entries(
        mine.reduce<Record<string, number>>((acc, t) => {
          const label = headcountLabel(t.headcount, assigned(t.id));
          acc[label] = (acc[label] ?? 0) + 1;
          return acc;
        }, {}),
      )
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => (a.label === "担当未定" ? -1 : b.label === "担当未定" ? 1 : a.label.localeCompare(b.label, "ja"))),
    };
    (e.absent ? off : working).push(row);
  }
  return { working, off };
}

// ---------------------------------------------------------------------------
// 職員表示（横軸＝職員）。印刷すると分担表。docs/screens.md §1
// 件数・予定時間は出さない（決定記録 0003 §4）
// ---------------------------------------------------------------------------

export interface StaffBar {
  task: TaskInstance;
  /** 帯に書く短い名前（個別は様名つき。グループ名は付けない: 行の幅が狭いので） */
  label: string;
  /** 読み上げ・ツールチップ用（グループ名つき） */
  fullLabel: string;
  isBreak: boolean;
  /** 同じ人のほかの帯と時間が重なる */
  overlap: boolean;
}

export interface StaffViewRow {
  staffId: ID;
  surname: string;
  slotName: string;
  startMin: Minutes;
  endMin: Minutes;
  firstTimer: boolean;
  bars: StaffBar[];
}

export interface WatchSegment {
  task: TaskInstance;
  /** 担当の名字（空なら担当未定） */
  surnames: string[];
  /** 未充足なら「担当未定」「担当あと n 人」。満たしていれば空 */
  label: string;
}

export interface WatchLine {
  groupId: ID;
  name: string;
  segments: WatchSegment[];
}

export function staffViewRows(state: State, date: string, groupId?: ID): StaffViewRow[] {
  const all = paletteRows(state, date).working;
  // 見るグループ（決定記録 0017）: そのグループに所属する人、その日の番がそのグループの人、そのグループの枠を担当している人、
  // 所属の無い人（介護助手・看護・応援など。共通の列と同じく、どのグループにも出す）
  const inGroup = (r: PaletteRow) => {
    const st = state.staff[r.staffId];
    if (!st) return false;
    if (!st.homeGroupId || st.homeGroupId === groupId) return true;
    const entry = Object.values(state.roster).find((e) => e.date === date && e.staffId === r.staffId && !e.absent);
    if (entry?.slotId && state.roleSlots[entry.slotId]?.groupId === groupId) return true;
    return Object.values(state.assignments).some((a) => {
      const t = state.tasks[a.taskId];
      return a.staffId === r.staffId && t?.date === date && t.status === "planned" && t.groupId === groupId;
    });
  };
  const working = groupId ? all.filter(inGroup) : all;
  const tasks = tasksForDate(state, date);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const mine = new Map<ID, TaskInstance[]>();
  for (const a of Object.values(state.assignments)) {
    const t = byId.get(a.taskId);
    if (!t) continue;
    if (!mine.has(a.staffId)) mine.set(a.staffId, []);
    mine.get(a.staffId)!.push(t);
  }
  return working.map((r) => {
    const list = (mine.get(r.staffId) ?? []).sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
    const bars: StaffBar[] = list.map((t) => ({
      task: t,
      label: t.targetMode === "individual" ? taskLabel(state, t) : t.name,
      fullLabel: taskLabel(state, t),
      isBreak: t.kind === "break",
      overlap: list.some((o) => o.id !== t.id && o.startMin < t.endMin && t.startMin < o.endMin),
    }));
    return {
      staffId: r.staffId,
      surname: r.surname,
      slotName: r.slotName,
      startMin: r.startMin,
      endMin: r.endMin,
      firstTimer: r.firstTimer,
      bars,
    };
  });
}

/** グループごとの見守りのつながり。空いている区切りは「担当未定」 */
export function watchLines(state: State, date: string): WatchLine[] {
  const groups = Object.values(state.groups).sort((a, b) => a.sortOrder - b.sortOrder);
  const watch = tasksForDate(state, date).filter(isWatchTask);
  const out: WatchLine[] = [];
  for (const g of groups) {
    const segs = watch.filter((t) => t.groupId === g.id);
    if (segs.length === 0) continue;
    out.push({
      groupId: g.id,
      name: g.name,
      segments: segs.map((t) => {
        const surnames = assigneesOf(state, t.id).map((s) => boardName(state, s.id));
        const label = headcountLabel(t.headcount, surnames.length);
        return { task: t, surnames, label: label === "OK" || label.endsWith("多め") ? "" : label };
      }),
    });
  }
  return out;
}

/** 分担表の下に並べる、担当未定・担当あと n 人の枠（休憩を除く。時刻順） */
export function unfilledTasks(state: State, date: string): { task: TaskInstance; label: string; status: string }[] {
  return tasksForDate(state, date)
    .filter((t) => t.kind !== "break")
    .map((t) => ({ task: t, label: taskLabel(state, t), status: headcountLabel(t.headcount, assigneesOf(state, t.id).length) }))
    .filter((x) => x.status === "担当未定" || x.status.startsWith("担当あと"));
}
