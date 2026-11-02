/**
 * テスト用の小さな架空施設。シード（ひまわり苑）とは別に、チェックの境界を確かめる最小構成。
 */

import { seedToEvents, deterministicContext } from "../loadSeed.ts";
import { applyEvents } from "../reducer.ts";
import { toMin } from "../time.ts";
import { emptyState, type SeedData, type State } from "../types.ts";

export const DATE = "2026-11-03";

export function miniSeed(): SeedData {
  return {
    facility: {
      id: "fac-mini",
      name: "テスト苑",
      settings: {
        checkMode: "warn",
        residentDisplayMode: "roomAndSurname",
        firstTimerOnlyWarning: true,
        boardStartMin: toMin(6),
        boardEndMin: toMin(22),
        categories: [
          { id: "core", name: "コア業務", kind: "core" },
          { id: "noncore", name: "ノンコア業務", kind: "noncore" },
        ],
      },
    },
    groups: [
      { id: "g-east", name: "東フロア", kind: "floor", sortOrder: 1 },
      { id: "g-common", name: "共通", kind: "common", sortOrder: 9 },
    ],
    residents: [
      { id: "r-101", displayName: "山田 キヨ", surname: "山田", groupId: "g-east", room: "101" },
      { id: "r-102", displayName: "松本 フミ", surname: "松本", groupId: "g-east", room: "102" },
      { id: "r-103", displayName: "井上 タケシ", surname: "井上", groupId: "g-east", room: "103" },
    ],
    staff: [
      { id: "s-sato", displayName: "佐藤 みき", surname: "佐藤", role: "介護福祉士", tags: ["介護福祉士", "入浴担当可"] },
      { id: "s-suzuki", displayName: "鈴木 だいち", surname: "鈴木", role: "介護職員", tags: ["入浴担当可"] },
      { id: "s-kato", displayName: "加藤 ゆい", surname: "加藤", role: "スポット", tags: [] },
      { id: "s-watanabe", displayName: "渡辺 さとし", surname: "渡辺", role: "介護助手", tags: [] },
    ],
    roleSlots: [
      { id: "slot-a", name: "早番A", defaultStartMin: toMin(7), defaultEndMin: toMin(16), sortOrder: 1 },
      { id: "slot-b", name: "日勤A", defaultStartMin: toMin(9), defaultEndMin: toMin(18), sortOrder: 2 },
      { id: "slot-helper", name: "介護助手", defaultStartMin: toMin(9), defaultEndMin: toMin(13), sortOrder: 3 },
      { id: "slot-spot", name: "スポット(午後)", defaultStartMin: toMin(13), defaultEndMin: toMin(17), sortOrder: 4 },
    ],
    templates: [
      {
        id: "t-bath",
        name: "入浴介助",
        kind: "care",
        categoryId: "core",
        targetMode: "group",
        defaultDurationMin: 90,
        defaultHeadcount: 2,
        requiredTags: ["入浴担当可"],
        place: "浴室",
        procedure: ["湯温を確認する"],
      },
      {
        id: "t-watch",
        name: "見守り",
        kind: "care",
        categoryId: "core",
        targetMode: "group",
        defaultDurationMin: 120,
        defaultHeadcount: 1,
        requiredTags: [],
        procedure: [],
      },
      {
        id: "t-linen",
        name: "リネン回収",
        kind: "care",
        categoryId: "noncore",
        targetMode: "none",
        defaultDurationMin: 30,
        defaultHeadcount: 1,
        requiredTags: [],
        procedure: [],
      },
      {
        id: "t-break",
        name: "休憩①",
        kind: "break",
        targetMode: "none",
        defaultDurationMin: 60,
        defaultHeadcount: 2,
        requiredTags: [],
        procedure: [],
      },
      {
        id: "t-oral",
        name: "口腔ケア",
        kind: "care",
        categoryId: "core",
        targetMode: "group",
        defaultDurationMin: 30,
        defaultHeadcount: 2,
        requiredTags: [],
        procedure: [],
      },
    ],
    patterns: [
      {
        id: "p-day",
        name: "平日",
        items: [
          // 見守り 9–11 [早番A]
          { id: "i1", templateId: "t-watch", startMin: toMin(9), endMin: toMin(11), groupId: "g-east", targetRule: "allInGroup", headcount: 1, slotIds: ["slot-a"] },
          // 入浴 10:30–12:00 [早番A, 日勤A, 介護助手] 必要3 → 介護助手が休みなら「担当あと1人」
          { id: "i2", templateId: "t-bath", startMin: toMin(10, 30), endMin: toMin(12), groupId: "g-east", targetRule: "residents", residentIds: ["r-101", "r-102"], headcount: 3, slotIds: ["slot-a", "slot-b", "slot-helper"] },
          // リネン回収 10:30–11:00 [介護助手] → 担当未定
          { id: "i3", templateId: "t-linen", startMin: toMin(10, 30), endMin: toMin(11), groupId: "g-common", targetRule: "none", headcount: 1, slotIds: ["slot-helper"] },
          // 休憩① 11:00–12:00 [日勤A]
          { id: "i4", templateId: "t-break", startMin: toMin(11), endMin: toMin(12), groupId: "g-common", targetRule: "none", headcount: 2, slotIds: ["slot-b"] },
          // 口腔ケア 13:00–13:30 [スポット(午後)] 必要2 → 初回の人だけ
          { id: "i5", templateId: "t-oral", startMin: toMin(13), endMin: toMin(13, 30), groupId: "g-east", targetRule: "allInGroup", headcount: 2, slotIds: ["slot-spot"] },
        ],
      },
    ],
    roster: [
      { id: "ro-sato", date: DATE, staffId: "s-sato", slotId: "slot-a", startMin: toMin(7), endMin: toMin(16), firstTimer: false, absent: false },
      { id: "ro-suzuki", date: DATE, staffId: "s-suzuki", slotId: "slot-b", startMin: toMin(9), endMin: toMin(18), firstTimer: false, absent: false },
      { id: "ro-kato", date: DATE, staffId: "s-kato", slotId: "slot-spot", startMin: toMin(13), endMin: toMin(17), firstTimer: true, absent: false },
      { id: "ro-watanabe", date: DATE, staffId: "s-watanabe", slotId: "slot-helper", startMin: toMin(9), endMin: toMin(13), firstTimer: false, absent: true },
    ],
    extraTasks: [],
    extraTargets: [],
    dayPatterns: [{ date: DATE, patternId: "p-day" }],
  };
}

export function miniState(): State {
  return applyEvents(emptyState(), seedToEvents(miniSeed(), deterministicContext()));
}

export function findTask(state: State, name: string) {
  const t = Object.values(state.tasks).find((x) => x.name === name);
  if (!t) throw new Error(`task not found: ${name}`);
  return t;
}
