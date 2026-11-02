/**
 * ボードの配置計算（純関数）。
 * 同じ列で時間が重なるカードは横に並べる（カレンダーの日表示と同じ考え方）。
 * - 重なりでつながったカードの塊（クラスタ）ごとに、最小の段数で詰める。
 * - 長い継続業務（見守り）は左の段に寄るよう、開始が早く長いものから置く。
 */

import type { ID, Minutes, State, TaskInstance } from "./types.ts";
import { tasksForDate } from "./checks.ts";

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

export function layoutColumn(tasks: TaskInstance[]): LaidOutCard[] {
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
      laneEnds.push(task.endMin);
    } else {
      laneEnds[lane] = task.endMin;
    }
    const card: LaidOutCard = { task, lane, lanes: 1 };
    out.push(card);
    cluster.push({ card, end: task.endMin });
    clusterEnd = Math.max(cluster.length === 1 ? task.endMin : clusterEnd, task.endMin);
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
}

/**
 * 列の配置。休憩以外で2時間以上の業務（見守りなど）は左のレールへ、それ以外は残りの幅で横に並べる。
 */
export function layoutGroupColumn(tasks: TaskInstance[]): { cards: LaidOutCard[]; hasRail: boolean } {
  const isRail = (t: TaskInstance) => t.kind !== "break" && t.endMin - t.startMin >= RAIL_MIN_DURATION;
  const railTasks = tasks.filter(isRail);
  const rest = tasks.filter((t) => !isRail(t));
  const rail = layoutColumn(railTasks).map((c) => ({ ...c, rail: true }));
  return { cards: [...rail, ...layoutColumn(rest)], hasRail: rail.length > 0 };
}

/** ボードの列（グループ順）。共通（common）は最後。中止した業務は出さない */
export function boardColumns(state: State, date: string): BoardColumn[] {
  const groups = Object.values(state.groups).sort((a, b) => a.sortOrder - b.sortOrder);
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
    const { cards, hasRail } = layoutGroupColumn(byGroup.get(g.id) ?? []);
    return {
      id: g.id,
      name: g.name,
      sub: g.kind === "common" ? "対象なし・休憩" : `${residentsIn(g.id)}人`,
      cards,
      hasRail,
    };
  });
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
  /** 休みの人の番に束ねた枠のうち、未充足の件数（休みの欄に「この人の番の枠 n 件が担当未定」） */
  unfilledSlotTasks: number;
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
    const row: PaletteRow = {
      staffId: staff.id,
      surname: staff.surname,
      slotName: e.slotId ? (state.roleSlots[e.slotId]?.name ?? "") : "",
      startMin: e.startMin,
      endMin: e.endMin,
      firstTimer: e.firstTimer,
      unfilledSlotTasks: e.absent
        ? tasks.filter((t) => t.kind !== "break" && e.slotId && t.slotIds.includes(e.slotId) && assigned(t.id) < t.headcount).length
        : 0,
    };
    (e.absent ? off : working).push(row);
  }
  return { working, off };
}
