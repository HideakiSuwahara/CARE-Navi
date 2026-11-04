/**
 * 配置チェックと充足バッジ。純関数。
 *
 * 文言の規則:
 * - 未割り当て ≠ 人手不足。「担当未定」「担当あと n 人」とだけ言う。
 * - 理由は一文。例: 「10:00–10:30 の「排泄介助 田中様」と重なります」
 * - 二重登録だけ禁止（block）。他は施設設定 checkMode が warn なら警告して許可。
 */

import { fmtMin, fmtRange } from "./time.ts";
import { overlaps, within } from "./time.ts";
import type {
  Assignment,
  HeadcountStatus,
  ID,
  Issue,
  IssueSeverity,
  RosterEntry,
  Staff,
  State,
  TaskInstance,
} from "./types.ts";

// ---------------------------------------------------------------------------
// 充足
// ---------------------------------------------------------------------------

export function assignmentsOf(state: State, taskId: ID): Assignment[] {
  return Object.values(state.assignments).filter((a) => a.taskId === taskId);
}

export function assigneesOf(state: State, taskId: ID): Staff[] {
  return assignmentsOf(state, taskId)
    .map((a) => state.staff[a.staffId])
    .filter((s): s is Staff => Boolean(s));
}

export function headcountLabel(required: number, assigned: number): string {
  if (required <= 0) return "";
  if (assigned === 0) return "担当未定";
  if (assigned < required) return `担当あと${required - assigned}人`;
  if (assigned === required) return "OK";
  return `${assigned - required}人 多め`;
}

/**
 * 充足の状態。休憩カードは「埋める枠」ではないので、常に無印（ok・空ラベル）。決定記録 0003 §5
 */
export function headcountStatus(state: State, taskId: ID): HeadcountStatus {
  const task = state.tasks[taskId];
  const required = task?.headcount ?? 0;
  const assigned = assignmentsOf(state, taskId).length;
  const gap = required - assigned;
  if (task?.kind === "break") return { required, assigned, gap, level: "ok", label: "" };
  let level: HeadcountStatus["level"] = "ok";
  if (required > 0 && assigned === 0) level = "unassigned";
  else if (assigned < required) level = "short";
  else if (assigned > required) level = "over";
  return { required, assigned, gap, level, label: headcountLabel(required, assigned) };
}

// ---------------------------------------------------------------------------
// 当日の勤務
// ---------------------------------------------------------------------------

export function rosterOf(state: State, date: string, staffId: ID): RosterEntry | undefined {
  return Object.values(state.roster).find((r) => r.date === date && r.staffId === staffId);
}

export function rosterForDate(state: State, date: string): RosterEntry[] {
  return Object.values(state.roster).filter((r) => r.date === date);
}

/** その日の業務（中止を除く） */
export function tasksForDate(state: State, date: string, includeCancelled = false): TaskInstance[] {
  return Object.values(state.tasks)
    .filter((t) => t.date === date && (includeCancelled || t.status === "planned"))
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin || a.name.localeCompare(b.name, "ja"));
}

/** 職員がその日に担当している業務（中止を除く） */
export function tasksOfStaff(state: State, date: string, staffId: ID): TaskInstance[] {
  const taskIds = new Set(
    Object.values(state.assignments)
      .filter((a) => a.staffId === staffId)
      .map((a) => a.taskId),
  );
  return tasksForDate(state, date).filter((t) => taskIds.has(t.id));
}

export function taskLabel(state: State, task: TaskInstance): string {
  if (task.targetMode === "individual") {
    const rid = state.targets[task.id]?.[0];
    const r = rid ? state.residents[rid] : undefined;
    return r ? `${task.name} ${r.surname}様` : task.name;
  }
  const g = task.groupId ? state.groups[task.groupId] : undefined;
  return g && g.kind !== "common" ? `${task.name}（${g.name}）` : task.name;
}

// ---------------------------------------------------------------------------
// チェック
// ---------------------------------------------------------------------------

function sev(state: State, code: Issue["code"]): IssueSeverity {
  if (code === "duplicate") return "block";
  if (code === "firstTimerOnly") return "warn";
  return state.facility?.settings.checkMode === "block" ? "block" : "warn";
}

/**
 * 職員 staffId を業務 taskId に割り当てた場合の問題一覧。
 * 問題がなければ空配列。順序: duplicate → absent/noRoster/offShift → onBreak → overlap → missingTags → firstTimerOnly
 */
export function checkAssignment(state: State, taskId: ID, staffId: ID): Issue[] {
  const task = state.tasks[taskId];
  const staff = state.staff[staffId];
  if (!task || !staff) return [];
  const issues: Issue[] = [];

  // 1. 二重登録（常に禁止）
  if (assignmentsOf(state, taskId).some((a) => a.staffId === staffId)) {
    issues.push({ code: "duplicate", severity: "block", message: "すでにこの業務の担当です" });
    return issues;
  }

  // 2. 勤務予定
  const entry = rosterOf(state, task.date, staffId);
  if (!entry) {
    issues.push({ code: "noRoster", severity: sev(state, "noRoster"), message: "本日の勤務予定がありません" });
  } else if (entry.absent) {
    issues.push({ code: "absent", severity: sev(state, "absent"), message: "本日休みです" });
  } else if (!within(task.startMin, task.endMin, entry.startMin, entry.endMin)) {
    const covers = overlaps(task.startMin, task.endMin, entry.startMin, entry.endMin);
    // 番の既定より早く帰る（早退）なら、その言い方にする
    const slotEnd = entry.slotId ? state.roleSlots[entry.slotId]?.defaultEndMin : undefined;
    const leftEarly = slotEnd !== undefined && entry.endMin < slotEnd && task.startMin >= entry.endMin;
    const message = leftEarly
      ? `${fmtMin(entry.endMin)} までの勤務です（早退）`
      : covers
      ? task.startMin < entry.startMin
        ? `${fmtRange(task.startMin, Math.min(entry.startMin, task.endMin))} は勤務前です（勤務 ${fmtRange(entry.startMin, entry.endMin)}）`
        : `${fmtRange(Math.max(entry.endMin, task.startMin), task.endMin)} は勤務後です（勤務 ${fmtRange(entry.startMin, entry.endMin)}）`
      : `この時間は勤務予定がありません（勤務 ${fmtRange(entry.startMin, entry.endMin)}）`;
    issues.push({ code: "offShift", severity: sev(state, "offShift"), message });
  }

  // 3. 休憩・4. 重なり（その職員が担当している他の業務）
  const others = tasksOfStaff(state, task.date, staffId).filter(
    (t) => t.id !== task.id && overlaps(task.startMin, task.endMin, t.startMin, t.endMin),
  );
  const breaks = others.filter((t) => t.kind === "break");
  const cares = others.filter((t) => t.kind !== "break");
  if (breaks.length > 0) {
    const b = breaks[0];
    issues.push({
      code: "onBreak",
      severity: sev(state, "onBreak"),
      // 丸数字はボードのカードだけ（手元画面・候補の文では「休憩」）
      message: `${fmtRange(b.startMin, b.endMin)} の休憩と重なります`,
      relatedTaskIds: breaks.map((t) => t.id),
    });
  }
  if (cares.length > 0) {
    const c = cares[0];
    const more = cares.length > 1 ? `（ほか${cares.length - 1}件）` : "";
    issues.push({
      code: "overlap",
      severity: sev(state, "overlap"),
      message: `${fmtRange(c.startMin, c.endMin)} の「${taskLabel(state, c)}」と重なります${more}`,
      relatedTaskIds: cares.map((t) => t.id),
    });
  }

  // 5. 担当条件
  const missing = task.requiredTags.filter((tag) => !staff.tags.includes(tag));
  if (missing.length > 0) {
    issues.push({
      code: "missingTags",
      severity: sev(state, "missingTags"),
      message: `条件「${missing.join("・")}」を満たしていません（施設の設定）`,
    });
  }

  // 6. 初回の方だけの配置
  if (state.facility?.settings.firstTimerOnlyWarning) {
    const current = assignmentsOf(state, taskId).map((a) => rosterOf(state, task.date, a.staffId));
    const allFirst = [...current, entry].every((r) => r?.firstTimer === true);
    if (allFirst && entry?.firstTimer) {
      issues.push({ code: "firstTimerOnly", severity: "warn", message: "初回の方だけの配置になります" });
    }
  }

  return issues;
}

/**
 * 候補の段（決定記録 0003 §6: 「問題なし」を開いて出し、他は畳む）。
 * - ok: 条件を満たし、時間も空いている
 * - warn: 注意（重なり・休憩・勤務時間の一部・条件不一致・初回のみ）。追加できる
 * - off: この時間に勤務予定がない（勤務外・欠勤・勤務予定なし）。追加ボタンを出さない
 * - blocked: 禁止（二重登録）
 */
export type CandidateTier = "ok" | "warn" | "off" | "blocked";

export interface Candidate {
  staff: Staff;
  entry?: RosterEntry;
  issues: Issue[];
  tier: CandidateTier;
  /** 当日の担当件数（並び順の補助にだけ使い、画面には出さない） */
  load: number;
  /** 業務が束ねられた番（役割枠）を持つ人（同じ段の中で先頭に出す） */
  sameSlot: boolean;
}

function tierOf(issues: Issue[]): CandidateTier {
  if (issues.some((i) => i.severity === "block")) return "blocked";
  if (issues.some((i) => i.code === "noRoster" || i.code === "absent")) return "off";
  if (issues.some((i) => i.code === "offShift" && i.message.startsWith("この時間は勤務予定がありません"))) return "off";
  if (issues.length === 0) return "ok";
  return "warn";
}

/**
 * 候補一覧。問題なし → 注意 → 勤務外・休み の順。
 * 同じ段では、その業務の番を持つ人 → 担当件数が少ない人 → 名前順。
 * すでに担当の人（duplicate）は除く。
 */
export function rankCandidates(state: State, taskId: ID): Candidate[] {
  const task = state.tasks[taskId];
  if (!task) return [];
  const order: Record<CandidateTier, number> = { ok: 0, warn: 1, off: 2, blocked: 3 };
  const out: Candidate[] = [];
  for (const staff of Object.values(state.staff)) {
    const issues = checkAssignment(state, taskId, staff.id);
    if (issues.some((i) => i.code === "duplicate")) continue;
    const entry = rosterOf(state, task.date, staff.id);
    out.push({
      staff,
      entry,
      issues,
      tier: tierOf(issues),
      load: tasksOfStaff(state, task.date, staff.id).length,
      sameSlot: Boolean(entry?.slotId && task.slotIds.includes(entry.slotId)),
    });
  }
  return out.sort(
    (a, b) =>
      order[a.tier] - order[b.tier] ||
      Number(b.sameSlot) - Number(a.sameSlot) ||
      a.load - b.load ||
      a.staff.displayName.localeCompare(b.staff.displayName, "ja"),
  );
}

/** 候補を「開いて出す人（問題なし）」と「畳む人」に分ける */
export function splitCandidates(cands: Candidate[]): { open: Candidate[]; folded: Candidate[]; warnCount: number; offCount: number } {
  const open = cands.filter((c) => c.tier === "ok");
  const folded = cands.filter((c) => c.tier !== "ok" && c.tier !== "blocked");
  return {
    open,
    folded,
    warnCount: folded.filter((c) => c.tier === "warn").length,
    offCount: folded.filter((c) => c.tier === "off").length,
  };
}

/**
 * 終わっていない枠（決定記録 0010）: 終わりの時刻を過ぎて、「終わった」の印が無い業務。休憩・中止は除く。
 * 「担当未定」とは別に数える。時刻順。
 */
export function unfinishedTasks(state: State, date: string, now: number): TaskInstance[] {
  return tasksForDate(state, date).filter((t) => t.kind !== "break" && !t.done && t.endMin <= now);
}

/** 見出しの文「終わっていない n 件」。0 件なら空 */
export function unfinishedLabel(count: number): string {
  return count > 0 ? `終わっていない ${count}件` : "";
}

/**
 * 見出し用のまとめ。ラベルごとの件数（例: [{label:"担当未定",count:2},{label:"担当あと1人",count:1}]）。
 * 担当未定を先に、担当あと n 人は n の小さい順。
 */
export function shortageGroups(state: State, date: string): { label: string; level: "unassigned" | "short"; count: number }[] {
  const map = new Map<string, { label: string; level: "unassigned" | "short"; count: number; gap: number }>();
  for (const t of tasksForDate(state, date)) {
    const s = headcountStatus(state, t.id);
    if (s.level !== "unassigned" && s.level !== "short") continue;
    const cur = map.get(s.label) ?? { label: s.label, level: s.level, count: 0, gap: s.level === "unassigned" ? -1 : s.gap };
    cur.count++;
    map.set(s.label, cur);
  }
  return [...map.values()].sort((a, b) => a.gap - b.gap).map(({ label, level, count }) => ({ label, level, count }));
}

/** その日の「担当未定」「担当あと n 人」の件数（ボードの見出し用） */
export function shortageSummary(state: State, date: string): { unassigned: number; short: number } {
  let unassigned = 0;
  let short = 0;
  for (const t of tasksForDate(state, date)) {
    const s = headcountStatus(state, t.id);
    if (s.level === "unassigned") unassigned++;
    else if (s.level === "short") short++;
  }
  return { unassigned, short };
}
