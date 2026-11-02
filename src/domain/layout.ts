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
}

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
  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    sub: g.kind === "common" ? "対象なし・休憩" : `${residentsIn(g.id)}人`,
    cards: layoutColumn(byGroup.get(g.id) ?? []),
  }));
}
