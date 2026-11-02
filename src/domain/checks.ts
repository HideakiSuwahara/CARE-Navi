/**
 * 配置チェックと充足バッジ。純関数。
 *
 * 文言の規則:
 * - 未割り当て ≠ 人手不足。「担当未定」「担当あと n 人」とだけ言う。
 * - 理由は一文。例: 「10:00–10:30 の「排泄介助 田中様」と重なります」
 * - 二重登録だけ禁止（block）。他は施設設定 checkMode が warn なら警告して許可。
 */

import { fmtRange } from "./time.ts";
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

export function headcountStatus(state: State, taskId: ID): HeadcountStatus {
  const task = state.tasks[taskId];
  const required = task?.headcount ?? 0;
  const assigned = assignmentsOf(state, taskId).length;
  const gap = required - assigned;
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
    issues.push({ code: "absent", severity: sev(state, "absent"), message: "本日は欠勤・早退です" });
  } else if (!within(task.startMin, task.endMin, entry.startMin, entry.endMin)) {
    const covers = overlaps(task.startMin, task.endMin, entry.startMin, entry.endMin);
    const message = covers
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
      message: `${fmtRange(b.startMin, b.endMin)} の「${b.name}」と重なります`,
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
 * 候補の段。
 * - ok: 条件を満たし、時間も空いている
 * - partial: 重なりだけがあり、業務時間の半分以上は空いている（「11:30 からなら入れます」）
 * - warn: 注意（重なり・休憩・勤務時間の一部・条件不一致・初回のみ）
 * - off: この時間に勤務予定がない（勤務外・欠勤・勤務予定なし）
 * - blocked: 禁止（二重登録）
 */
export type CandidateTier = "ok" | "partial" | "warn" | "off" | "blocked";

export interface Candidate {
  staff: Staff;
  entry?: RosterEntry;
  issues: Issue[];
  tier: CandidateTier;
  /** 当日の担当件数（並び順の補助） */
  load: number;
  /** 業務が束ねられた役割枠を持つ人（同じ段の中で先頭に出す） */
  sameSlot: boolean;
  /** partial のとき、空いている時間帯。例: 「11:30–12:00」 */
  freeRange?: string;
}

function freePortion(task: TaskInstance, busy: TaskInstance[]): { freeMin: number; range?: string } {
  // 重なる業務を除いた「空き」を前後から求める（間に挟まる空きは数えない: 現場で使いにくい）
  let start = task.startMin;
  let end = task.endMin;
  for (const b of busy) {
    if (b.startMin <= start && b.endMin > start) start = Math.max(start, b.endMin);
    if (b.endMin >= end && b.startMin < end) end = Math.min(end, b.startMin);
  }
  const freeMin = Math.max(0, end - start);
  return freeMin > 0 ? { freeMin, range: fmtRange(start, end) } : { freeMin: 0 };
}

function tierOf(state: State, task: TaskInstance, issues: Issue[]): { tier: CandidateTier; freeRange?: string } {
  if (issues.some((i) => i.severity === "block")) return { tier: "blocked" };
  if (issues.some((i) => i.code === "noRoster" || i.code === "absent")) return { tier: "off" };
  if (issues.some((i) => i.code === "offShift" && i.message.startsWith("この時間は勤務予定がありません"))) return { tier: "off" };
  if (issues.length === 0) return { tier: "ok" };
  const onlyOverlap = issues.every((i) => i.code === "overlap");
  if (onlyOverlap) {
    const related = issues.flatMap((i) => i.relatedTaskIds ?? []).map((id) => state.tasks[id]).filter((t): t is TaskInstance => Boolean(t));
    const fp = freePortion(task, related);
    if (fp.freeMin * 2 >= task.endMin - task.startMin) return { tier: "partial", freeRange: fp.range };
  }
  return { tier: "warn" };
}

/**
 * 候補一覧。問題なし → 部分参加 → 注意 → 勤務外・休み の順。
 * 同じ段では、その業務の役割枠を持つ人 → 担当件数が少ない人 → 名前順。
 * すでに担当の人（duplicate）は除く。
 */
export function rankCandidates(state: State, taskId: ID): Candidate[] {
  const task = state.tasks[taskId];
  if (!task) return [];
  const order: Record<CandidateTier, number> = { ok: 0, partial: 1, warn: 2, off: 3, blocked: 4 };
  const out: Candidate[] = [];
  for (const staff of Object.values(state.staff)) {
    const issues = checkAssignment(state, taskId, staff.id);
    if (issues.some((i) => i.code === "duplicate")) continue;
    const entry = rosterOf(state, task.date, staff.id);
    const { tier, freeRange } = tierOf(state, task, issues);
    out.push({
      staff,
      entry,
      issues,
      tier,
      load: tasksOfStaff(state, task.date, staff.id).length,
      sameSlot: Boolean(entry?.slotId && task.slotIds.includes(entry.slotId)),
      freeRange,
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
