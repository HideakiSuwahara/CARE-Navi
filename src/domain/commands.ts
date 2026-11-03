/**
 * コマンド = UI の1操作を、イベントの列と「こう変わります」の行に変換する。
 * - 変更は10秒以内: すべてのコマンドは1つの batchId にまとまり、1回で元に戻せる。
 * - クイック操作（欠勤・早退／付き添い・外出を追加／ずらす／中止／担当を外す）は
 *   プレビュー（PreviewLine[]）を返し、人が確認してから適用する。
 * - 重なりで担当を外す提案は、ここで決定的に作る（推測しない）。
 */

import type { Event } from "./events.ts";
import { applyEvents } from "./reducer.ts";
import { metaOf, type EventContext } from "./pattern.ts";
import { assignmentsOf, headcountStatus, rosterOf, taskLabel as boardLabel, tasksOfStaff } from "./checks.ts";
import { staffTaskName } from "./myday.ts";
import { fmtRange, overlaps } from "./time.ts";
import type { DateKey, ID, Minutes, State, TaskInstance } from "./types.ts";

/** プレビューの文で使う業務名。休憩は丸数字を外す（丸数字はボードのカードだけ） */
function taskLabel(state: State, task: TaskInstance): string {
  return task.kind === "break" ? staffTaskName(task) : boardLabel(state, task);
}

export interface PreviewLine {
  kind: "add" | "remove" | "cancel" | "move" | "unassign" | "assign" | "effect";
  text: string;
  /** この行に対応するイベント。チェックを外すと適用しない。effect 行は空 */
  eventIds: ID[];
  /** 外せる行か（effect は外せない） */
  optional: boolean;
  /** 最初からチェックが入っているか。省略は true。候補として出すだけの行は false */
  defaultOn?: boolean;
  /** 結果の行（「担当未定になります」）。画面はチェックに合わせて effectLines で作り直す */
  computed?: boolean;
}

export interface Preview {
  title: string;
  lines: PreviewLine[];
  events: Event[];
}

/** 最初にチェックを外しておく行のイベント（defaultOn: false の行） */
export function defaultUnchecked(preview: Preview): Set<ID> {
  return new Set(preview.lines.filter((l) => l.defaultOn === false).flatMap((l) => l.eventIds));
}

/** 選んだ行だけのイベントに絞る */
export function selectPreview(preview: Preview, uncheckedEventIds: Set<ID>): Event[] {
  return preview.events.filter((e) => !uncheckedEventIds.has(e.eventId));
}

/** 適用後に新しく「担当未定／担当あと n 人」になる業務を effect 行にする（チェックを変えたら画面で作り直す） */
export function effectLines(state: State, events: Event[], date: DateKey): PreviewLine[] {
  return effectsAfter(state, events, date);
}

function effectsAfter(state: State, events: Event[], date: DateKey): PreviewLine[] {
  const after = applyEvents(state, events);
  const lines: PreviewLine[] = [];
  for (const t of Object.values(after.tasks)) {
    if (t.date !== date || t.status !== "planned") continue;
    const before = state.tasks[t.id] ? headcountStatus(state, t.id) : null;
    const now = headcountStatus(after, t.id);
    if ((now.level === "unassigned" || now.level === "short") && (!before || before.level !== now.level || before.assigned !== now.assigned)) {
      if (before && before.assigned <= now.assigned) continue;
      lines.push({
        kind: "effect",
        text: `「${taskLabel(after, t)} ${fmtRange(t.startMin, t.endMin)}」が ${now.label === "担当未定" ? "担当未定" : `担当あと${now.required - now.assigned}人`} になります`,
        eventIds: [],
        optional: false,
        computed: true,
      });
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------
// 基本操作
// ---------------------------------------------------------------------------

export function assignEvents(taskId: ID, staffId: ID, ctx: EventContext): Event[] {
  return [{ ...metaOf(ctx), type: "assignment.add", assignment: { id: ctx.newId(), taskId, staffId } }];
}

export function unassignEvents(state: State, taskId: ID, staffId: ID, ctx: EventContext): Event[] {
  return assignmentsOf(state, taskId)
    .filter((a) => a.staffId === staffId)
    .map((a) => ({ ...metaOf(ctx), type: "assignment.remove" as const, id: a.id }));
}

/** 担当を別の業務へ移す（カードからカードへ） */
export function moveAssignmentEvents(state: State, fromTaskId: ID, toTaskId: ID, staffId: ID, ctx: EventContext): Event[] {
  return [...unassignEvents(state, fromTaskId, staffId, ctx), ...assignEvents(toTaskId, staffId, ctx)];
}

export function cancelTaskEvents(taskId: ID, ctx: EventContext, note?: string): Event[] {
  return [{ ...metaOf(ctx), type: "task.update", id: taskId, patch: { status: "cancelled", ...(note ? { note } : {}) } }];
}

export function restoreTaskEvents(taskId: ID, ctx: EventContext): Event[] {
  return [{ ...metaOf(ctx), type: "task.update", id: taskId, patch: { status: "planned" } }];
}

/** ずらす（±15/30/60 分、または時刻入力）。長さは保つ */
export function shiftTaskEvents(state: State, taskId: ID, deltaMin: Minutes, ctx: EventContext): Event[] {
  const t = state.tasks[taskId];
  if (!t) return [];
  return [
    { ...metaOf(ctx), type: "task.update", id: taskId, patch: { startMin: t.startMin + deltaMin, endMin: t.endMin + deltaMin } },
  ];
}

export function setTaskTimeEvents(taskId: ID, startMin: Minutes, endMin: Minutes, ctx: EventContext): Event[] {
  return [{ ...metaOf(ctx), type: "task.update", id: taskId, patch: { startMin, endMin } }];
}

// ---------------------------------------------------------------------------
// クイック操作（プレビュー付き。スマホで3タップ以内: ボタン → 選ぶ → 決定）
// 決定記録 0003 §3・§5: 既定値を入れておく。休憩は外さず後ろへずらす。
// ---------------------------------------------------------------------------

/** 15分単位で切り上げ */
function ceil15(min: Minutes): Minutes {
  return Math.ceil(min / 15) * 15;
}

/** 付き添いの既定の時間帯: 今から（15分単位に切り上げ）90分 */
export function defaultEscortRange(nowMin: Minutes, durationMin: Minutes = 90): { startMin: Minutes; endMin: Minutes } {
  const startMin = ceil15(nowMin);
  return { startMin, endMin: startMin + durationMin };
}

/**
 * 休憩と重なったときの「ずらし先」を決める（決定的）。
 * 1. その人の他の予定と重ならない、後ろの休憩カードがあればそこへ移る
 * 2. なければ、付き添い等の終わりから同じ長さの「休憩」を新しく作る
 */
function relocateBreak(
  state: State,
  staffId: ID,
  brk: TaskInstance,
  blockEndMin: Minutes,
  busy: { startMin: Minutes; endMin: Minutes }[],
  ctx: EventContext,
  /** このプレビューで担当から外す業務（空きを調べるときに数えない） */
  releasing: Set<ID> = new Set(),
): { events: Event[]; text: string; fits: boolean } {
  const name = state.staff[staffId]?.surname ?? "";
  const length = brk.endMin - brk.startMin;
  const myTasks = tasksOfStaff(state, brk.date, staffId).filter((t) => t.id !== brk.id && !releasing.has(t.id));
  // 休憩は勤務時間の中に限る（退勤後に休憩を作らない）
  const shiftEnd = rosterOf(state, brk.date, staffId)?.endMin ?? brk.endMin;
  const free = (s: Minutes, e: Minutes) =>
    e <= shiftEnd && !myTasks.some((t) => overlaps(s, e, t.startMin, t.endMin)) && !busy.some((b) => overlaps(s, e, b.startMin, b.endMin));
  const removeEvs = unassignEvents(state, brk.id, staffId, ctx);

  const later = Object.values(state.tasks)
    .filter((t) => t.date === brk.date && t.kind === "break" && t.status === "planned" && t.id !== brk.id && t.startMin >= blockEndMin)
    .sort((a, b) => a.startMin - b.startMin)
    .find((t) => free(t.startMin, t.endMin) && !assignmentsOf(state, t.id).some((a) => a.staffId === staffId));
  if (later) {
    // 移り先に同じ時間に休憩する人を添える（判定はしない。フロアが空くかはリーダーが見る）
    const others = assignmentsOf(state, later.id).map((a) => state.staff[a.staffId]?.surname).filter(Boolean);
    return {
      events: [...removeEvs, ...assignEvents(later.id, staffId, ctx)],
      text: `ずらす: ${name} の休憩 ${fmtRange(brk.startMin, brk.endMin)} → 「${later.name}」${fmtRange(later.startMin, later.endMin)}${others.length > 0 ? `（同じ時間に休憩: ${others.join("・")}）` : ""}`,
      fits: true,
    };
  }

  let start = ceil15(blockEndMin);
  while (!free(start, start + length) && start + length < shiftEnd) start += 15;
  if (!free(start, start + length)) {
    // 勤務内に収まらない: 休憩からは外すが、新しい休憩は作らない。リーダーが決める
    return {
      events: removeEvs,
      text: `${name} の休憩 ${fmtRange(brk.startMin, brk.endMin)} は勤務内に取り直せません（休憩の時間はリーダーが決めてください）`,
      fits: false,
    };
  }
  const taskId = ctx.newId();
  const own: TaskInstance = {
    ...brk,
    id: taskId,
    name: `休憩（${name}）`,
    startMin: start,
    endMin: start + length,
    headcount: 1,
    slotIds: [],
    origin: "manual",
  };
  return {
    events: [
      ...removeEvs,
      { ...metaOf(ctx), type: "task.add", task: own, residentIds: [] },
      ...assignEvents(taskId, staffId, ctx),
    ],
    text: `ずらす: ${name} の休憩 ${fmtRange(brk.startMin, brk.endMin)} → ${fmtRange(start, start + length)}`,
    fits: true,
  };
}

export interface EscortInput {
  date: DateKey;
  residentId: ID;
  /** 既定: 受診の付き添い */
  name?: string;
  /** 既定: defaultEscortRange(nowMin) */
  startMin: Minutes;
  endMin: Minutes;
  /** 任意。空なら担当未定で作る（プレビューで付けられる） */
  staffId?: ID;
  templateId?: ID;
  groupId?: ID;
  place?: string;
}

export const ESCORT_NAMES = ["受診の付き添い", "外出の付き添い", "入院の付き添い", "その他の付き添い"] as const;

/**
 * 付き添い・外出を追加。
 * - 個別業務を1件足す（担当は任意）
 * - 担当者の重なる業務からは外す（外せる行）。重なる休憩は外さず後ろへずらす
 * - 同じ利用者の同じ時間の個別業務は「中止」の候補として出す（最初はチェックなし）
 */
export function escortPreview(state: State, input: EscortInput, ctx: EventContext): Preview {
  const name = input.name ?? ESCORT_NAMES[0];
  const staff = input.staffId ? state.staff[input.staffId] : undefined;
  const resident = state.residents[input.residentId];
  const tpl = input.templateId ? state.templates[input.templateId] : undefined;
  const taskId = ctx.newId();
  const task: TaskInstance = {
    id: taskId,
    date: input.date,
    templateId: tpl?.id,
    name,
    kind: "care",
    categoryId: tpl?.categoryId ?? "core",
    targetMode: "individual",
    groupId: input.groupId ?? resident?.groupId,
    startMin: input.startMin,
    endMin: input.endMin,
    place: input.place ?? tpl?.place,
    headcount: 1,
    requiredTags: tpl ? [...tpl.requiredTags] : [],
    slotIds: [],
    scopeNote: tpl?.scopeNote,
    outOfScopeNote: tpl?.outOfScopeNote,
    procedure: tpl?.procedure ? [...tpl.procedure] : undefined,
    supplies: tpl?.supplies,
    contact: tpl?.contact,
    status: "planned",
    origin: "manual",
  };

  const events: Event[] = [];
  const lines: PreviewLine[] = [];
  const addEv: Event = { ...metaOf(ctx), type: "task.add", task, residentIds: [input.residentId] };
  events.push(addEv);
  const addIds = [addEv.eventId];
  if (input.staffId) {
    const asg = assignEvents(taskId, input.staffId, ctx);
    events.push(...asg);
    addIds.push(...asg.map((e) => e.eventId));
  }
  lines.push({
    kind: "add",
    text: `追加: ${name} ${resident ? `${resident.surname}様` : ""} ${fmtRange(input.startMin, input.endMin)}${staff ? ` → 担当 ${staff.surname}` : ""}`,
    eventIds: addIds,
    optional: false,
  });

  if (input.staffId) {
    const mine = tasksOfStaff(state, input.date, input.staffId).filter((t) => overlaps(input.startMin, input.endMin, t.startMin, t.endMin));
    const releasing = new Set(mine.filter((t) => t.kind !== "break").map((t) => t.id));
    for (const t of mine) {
      if (t.kind === "break") {
        const moved = relocateBreak(state, input.staffId, t, input.endMin, [{ startMin: input.startMin, endMin: input.endMin }], ctx, releasing);
        events.push(...moved.events);
        lines.push({ kind: moved.fits ? "move" : "effect", text: moved.text, eventIds: moved.events.map((e) => e.eventId), optional: moved.fits });
        continue;
      }
      for (const ev of unassignEvents(state, t.id, input.staffId, ctx)) {
        events.push(ev);
        lines.push({
          kind: "unassign",
          text: `外す: ${staff?.surname ?? ""} → 「${taskLabel(state, t)} ${fmtRange(t.startMin, t.endMin)}」（付き添いと重なるため）`,
          eventIds: [ev.eventId],
          optional: true,
        });
      }
    }
  }

  // 同じ利用者の同じ時間の業務（ご本人が不在のため）
  // - 個別: 付き添いの時間にすっぽり入るものは中止（既定でチェック）。端だけ重なるものは候補として出す（帰ってから行うことが多い）
  // - 一括: 対象の方から外す候補として出す（既定はチェックなし）。枠そのものは残す
  const who = resident ? `${resident.surname}様` : "ご本人";
  for (const t of Object.values(state.tasks)) {
    if (t.date !== input.date || t.status !== "planned" || t.kind === "break") continue;
    const ids = state.targets[t.id] ?? [];
    if (!ids.includes(input.residentId)) continue;
    if (!overlaps(input.startMin, input.endMin, t.startMin, t.endMin)) continue;
    if (t.targetMode === "individual") {
      const inside = input.startMin <= t.startMin && t.endMin <= input.endMin;
      const evs = cancelTaskEvents(t.id, ctx, `${name}のため`);
      events.push(...evs);
      lines.push({
        kind: "cancel",
        text: `中止する: 「${taskLabel(state, t)} ${fmtRange(t.startMin, t.endMin)}」（${who}が不在のため${inside ? "" : "。時間が一部だけ重なります"}）`,
        eventIds: evs.map((e) => e.eventId),
        optional: true,
        defaultOn: inside,
      });
    } else if (t.targetMode === "group") {
      const ev: Event = { ...metaOf(ctx), type: "task.setTargets", id: t.id, residentIds: ids.filter((x) => x !== input.residentId) };
      events.push(ev);
      lines.push({
        kind: "remove",
        text: `対象の方から外す: ${who} → 「${taskLabel(state, t)} ${fmtRange(t.startMin, t.endMin)}」（不在の時間と重なります）`,
        eventIds: [ev.eventId],
        optional: true,
        defaultOn: false,
      });
    }
  }

  const preview: Preview = { title: "付き添い・外出", lines, events };
  preview.lines.push(...effectsAfter(state, selectPreview(preview, defaultUnchecked(preview)), input.date));
  return preview;
}

/**
 * 欠勤・早退。nowMin が勤務開始前（または未指定）なら欠勤、勤務中なら今の時刻（15分切り上げ）で早退。
 * 本日の残りの担当をすべて外し、空く枠を示す。
 */
export function absencePreview(
  state: State,
  date: DateKey,
  staffId: ID,
  ctx: EventContext,
  nowMin?: Minutes,
  /** 既定（時刻で決める）と違うとき: 勤務開始の直後でも来ていなければ "absent" */
  force?: "absent" | "leave",
): Preview {
  const staff = state.staff[staffId];
  const entry = rosterOf(state, date, staffId);
  const name = staff?.surname ?? "職員";
  const inShift = entry !== undefined && nowMin !== undefined && nowMin > entry.startMin && nowMin < entry.endMin;
  const leaveAtMin = entry && nowMin !== undefined && force !== "absent" && (inShift || force === "leave") && nowMin < entry.endMin ? Math.max(ceil15(nowMin), entry.startMin) : undefined;
  const lines: PreviewLine[] = [];
  const events: Event[] = [];

  if (entry) {
    const updated = leaveAtMin === undefined ? { ...entry, absent: true } : { ...entry, endMin: leaveAtMin };
    const ev: Event = { ...metaOf(ctx), type: "roster.upsert", entry: updated };
    events.push(ev);
    lines.push({
      kind: "move",
      text: leaveAtMin === undefined ? `${name} を本日「欠勤」にする` : `${name} の勤務を ${fmtRange(entry.startMin, leaveAtMin)} にする（早退）`,
      eventIds: [ev.eventId],
      optional: false,
    });
  }

  for (const t of tasksOfStaff(state, date, staffId)) {
    if (leaveAtMin !== undefined && t.endMin <= leaveAtMin) continue;
    for (const ev of unassignEvents(state, t.id, staffId, ctx)) {
      events.push(ev);
      lines.push({
        kind: "unassign",
        text: `外す: ${name} → 「${taskLabel(state, t)} ${fmtRange(t.startMin, t.endMin)}」`,
        eventIds: [ev.eventId],
        // 休む・帰る人を担当に残しても意味がないので、外せない行にする
        optional: false,
      });
    }
  }

  lines.push(...effectsAfter(state, events, date));
  return { title: leaveAtMin === undefined ? "欠勤" : "早退", lines, events };
}

/**
 * 休憩をずらす（既定 +30分）。
 * - staffId を渡すと、その人だけを動かす（休憩カードは複数人で共有しているため。決定記録 0003 / loop2）
 *   その人を休憩カードから外し、ずらした時刻に自分の休憩を作る。勤務内に限る。
 * - staffId を省くと、休憩カードごと動かす（全員が動く）。
 */
export function shiftBreakPreview(state: State, taskId: ID, deltaMin: Minutes, ctx: EventContext, staffId?: ID): Preview {
  const t = state.tasks[taskId];
  if (!t) return { title: "休憩をずらす", lines: [], events: [] };
  const to = { startMin: t.startMin + deltaMin, endMin: t.endMin + deltaMin };

  if (staffId) {
    const name = state.staff[staffId]?.surname ?? "";
    const entry = rosterOf(state, t.date, staffId);
    const shiftEnd = entry?.endMin ?? to.endMin;
    const shiftStart = entry?.startMin ?? to.startMin;
    if (to.endMin > shiftEnd || to.startMin < shiftStart) {
      return {
        title: "休憩をずらす",
        lines: [
          {
            kind: "effect",
            text: `${name} の勤務は ${fmtRange(shiftStart, shiftEnd)} のため、${fmtRange(to.startMin, to.endMin)} には取れません`,
            eventIds: [],
            optional: false,
          },
        ],
        events: [],
      };
    }
    // その人だけが入っている休憩は、カードごと動かす（空の休憩カードを残さない）
    const sole = assignmentsOf(state, taskId).every((a) => a.staffId === staffId);
    if (sole) {
      const events = shiftTaskEvents(state, taskId, deltaMin, ctx);
      const lines: PreviewLine[] = [
        { kind: "move", text: `${name} の休憩を ${fmtRange(t.startMin, t.endMin)} → ${fmtRange(to.startMin, to.endMin)} にする`, eventIds: events.map((e) => e.eventId), optional: false },
      ];
      for (const o of tasksOfStaff(state, t.date, staffId)) {
        if (o.id !== taskId && overlaps(to.startMin, to.endMin, o.startMin, o.endMin)) {
          lines.push({ kind: "effect", text: `${name} は「${taskLabel(state, o)} ${fmtRange(o.startMin, o.endMin)}」と重なります`, eventIds: [], optional: false });
        }
      }
      return { title: "休憩をずらす", lines, events };
    }
    const ownId = ctx.newId();
    const own: TaskInstance = { ...t, id: ownId, name: `休憩（${name}）`, ...to, headcount: 1, slotIds: [], origin: "manual" };
    const events: Event[] = [
      ...unassignEvents(state, taskId, staffId, ctx),
      { ...metaOf(ctx), type: "task.add", task: own, residentIds: [] },
      ...assignEvents(ownId, staffId, ctx),
    ];
    const lines: PreviewLine[] = [
      { kind: "move", text: `${name} の休憩を ${fmtRange(t.startMin, t.endMin)} → ${fmtRange(to.startMin, to.endMin)} にする`, eventIds: events.map((e) => e.eventId), optional: false },
    ];
    for (const o of tasksOfStaff(state, t.date, staffId)) {
      if (o.id !== taskId && overlaps(to.startMin, to.endMin, o.startMin, o.endMin)) {
        lines.push({ kind: "effect", text: `${name} は「${taskLabel(state, o)} ${fmtRange(o.startMin, o.endMin)}」と重なります`, eventIds: [], optional: false });
      }
    }
    return { title: "休憩をずらす", lines, events };
  }

  const events = shiftTaskEvents(state, taskId, deltaMin, ctx);
  const lines: PreviewLine[] = [
    {
      kind: "move",
      text: `「${staffTaskName(t)}」を ${fmtRange(t.startMin, t.endMin)} → ${fmtRange(to.startMin, to.endMin)} にする（全員）`,
      eventIds: events.map((e) => e.eventId),
      optional: false,
    },
  ];
  for (const a of assignmentsOf(state, taskId)) {
    const others = tasksOfStaff(state, t.date, a.staffId).filter((o) => o.id !== taskId && overlaps(to.startMin, to.endMin, o.startMin, o.endMin));
    for (const o of others) {
      lines.push({
        kind: "effect",
        text: `${state.staff[a.staffId]?.surname ?? ""} は「${taskLabel(state, o)} ${fmtRange(o.startMin, o.endMin)}」と重なります`,
        eventIds: [],
        optional: false,
      });
    }
  }
  return { title: "休憩をずらす", lines, events };
}
