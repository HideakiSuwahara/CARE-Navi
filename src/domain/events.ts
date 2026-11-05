/**
 * 操作イベント。状態（State）はイベントの列から組み立てる。
 * - すべての変更はイベント。UI は状態を直接書き換えない。
 * - 同期＝イベントの送受信。ローカル保存＝イベント列＋スナップショット。
 * - Undo＝打ち消しイベント（invert）。同じ操作でまとめた batchId 単位で戻す。
 * - リデューサは決定的。ID や時刻はイベントの中に入れて渡す（リデューサ内で生成しない）。
 */

import type {
  Assignment,
  DateKey,
  DayPattern,
  Facility,
  Group,
  ID,
  Minutes,
  Resident,
  ResidentSheet,
  RoleSlot,
  RosterEntry,
  Staff,
  TaskInstance,
  TaskTemplate,
} from "./types.ts";

export interface EventMeta {
  /** イベントID（UUID）。重複配信の排除に使う。本文の id（対象のID）と区別するため eventId */
  eventId: ID;
  /** 発生時刻 ISO 8601 */
  ts: string;
  /** まとめて戻す単位。クイック操作や「型を当てる」は複数イベントを1つの batchId に束ねる */
  batchId: ID;
  /** 操作した人（任意。見出しには出さず、履歴でだけ見る） */
  actorId?: ID;
}

export type EventBody =
  | { type: "facility.set"; facility: Facility }
  | { type: "group.upsert"; group: Group }
  | { type: "group.remove"; id: ID }
  | { type: "resident.upsert"; resident: Resident }
  /** fromDate があれば、その日以降の枠の対象からだけ外す（過去は履歴として残す。決定記録 0015） */
  | { type: "resident.remove"; id: ID; fromDate?: DateKey }
  | { type: "staff.upsert"; staff: Staff }
  | { type: "staff.remove"; id: ID }
  | { type: "roleSlot.upsert"; roleSlot: RoleSlot }
  | { type: "roleSlot.remove"; id: ID }
  | { type: "template.upsert"; template: TaskTemplate }
  | { type: "template.remove"; id: ID }
  | { type: "pattern.upsert"; pattern: DayPattern }
  | { type: "pattern.remove"; id: ID }
  | { type: "roster.upsert"; entry: RosterEntry }
  | { type: "roster.remove"; id: ID }
  | { type: "task.add"; task: TaskInstance; residentIds: ID[] }
  | { type: "task.remove"; id: ID }
  | {
      type: "task.update";
      id: ID;
      patch: Partial<
        Pick<
          TaskInstance,
          | "name"
          | "startMin"
          | "endMin"
          | "place"
          | "headcount"
          | "requiredTags"
          | "note"
          | "status"
          | "groupId"
          | "categoryId"
          | "procedure"
          | "scopeNote"
          | "outOfScopeNote"
          | "supplies"
          | "contact"
        >
      >;
    }
  | { type: "task.setTargets"; id: ID; residentIds: ID[] }
  /** 「終わった」の印の付け外し（決定記録 0010）。誰が付けたかは actorId に残し、画面には出さない */
  | { type: "task.done"; id: ID; done: boolean }
  | { type: "assignment.add"; assignment: Assignment }
  /** taskId/staffId は、同時に足した割当が別の id で届いたときの保険（id が無ければ同じ業務・同じ人の割当を外す） */
  | { type: "assignment.remove"; id: ID; taskId?: ID; staffId?: ID }
  | { type: "day.setPattern"; date: DateKey; patternId?: ID }
  /** 24時間シートを丸ごと置き換える（行の追加・変更・削除はすべてこれ） */
  | { type: "sheet.upsert"; sheet: ResidentSheet };

export type Event = EventMeta & EventBody;

export type EventType = EventBody["type"];

/** 時刻変更の刻み（分）。UI の「ずらす」メニューで使う */
export const SHIFT_STEPS: Minutes[] = [15, 30, 60];
