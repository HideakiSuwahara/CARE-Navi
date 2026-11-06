/**
 * 設定の「追加・変更」: 施設の名前・グループ（ユニット・フロア）・番（役割枠）を、施設を作ったあとに足す・直す・外す。
 * 決定記録 0016、グリル 2026-11-06。
 * - グループを足すと、雛形（サンプル）の同じ種類のグループの番と業務表の枠を写す（「自分の施設で始める」と同じ考え方）。
 * - 所属（利用者・職員）が残るグループ、今日以降の勤務表や業務表に使われている番は消せない（理由を一文）。
 * - 番の時刻を変えても、入れてある勤務表の時刻は変えない（次に貼る分と、朝の帯で選び直した日から効く）。
 * - 業務の種類（テンプレート）と業務表の編集は作らない（0001・0003）。
 */

import type { Event } from "./events.ts";
import { metaOf, type EventContext } from "./pattern.ts";
import { fmtMin } from "./time.ts";
import type { DateKey, DayPatternItem, Group, ID, RoleSlot, SeedData, State } from "./types.ts";

export interface MasterResult {
  events: Event[];
  label: string;
  error?: string;
}

/** グループの名前から種類を決める（「ユニット」を含めばユニット、ほかはフロア） */
export function groupKindOf(name: string): Group["kind"] {
  return /ユニット/.test(name) ? "unit" : "floor";
}

/** 雛形のグループの短い名前（「東フロア」→「東」、「さくらユニット」→「さくら」） */
function shortName(name: string): string {
  return name.replace(/フロア|ユニット/g, "").trim() || name;
}

const squash = (s: string) => s.replace(/[\s　]+/g, " ").trim();

/** 施設の名前を直す */
export function renameFacilityEvents(state: State, name: string, ctx: EventContext): MasterResult {
  const n = squash(name);
  const f = state.facility;
  if (!f) return { events: [], label: "", error: "施設がまだありません" };
  if (!n) return { events: [], label: "", error: "施設の名前を入れてください" };
  if (n === f.name) return { events: [], label: "" };
  return { events: [{ ...metaOf(ctx), type: "facility.set", facility: { ...f, name: n } }], label: `施設の名前を「${n}」にしました` };
}

/** グループの所属（利用者・職員の人数） */
export function groupMembers(state: State, groupId: ID): { residents: number; staff: number } {
  return {
    residents: Object.values(state.residents).filter((r) => r.groupId === groupId).length,
    staff: Object.values(state.staff).filter((s) => s.homeGroupId === groupId).length,
  };
}

/**
 * グループを足す。雛形の同じ種類のグループ（無ければ最初のグループ）の番と、施設の各業務表にその枠を写す。
 * - 番はグループの名前で付け直す（「夜勤東」→「夜勤 3階」）。リーダーの順は写さない（施設のリーダーは既に決まっている）。
 * - 業務表: 施設の業務表（雛形と同じ ID）に、雛形の同じグループの項目を新しい ID で足す。対象の方を決めていた項目は写さない（一括の入浴は全員の日課として写す）。
 * - グループを持たない番（介護助手・看護・スポット）の項目は、施設にその番があれば束ねる。
 */
export function addGroupEvents(state: State, name: string, template: SeedData, ctx: EventContext, kindIn?: Group["kind"]): MasterResult {
  const n = squash(name);
  if (!n) return { events: [], label: "", error: "グループの名前を入れてください" };
  if (Object.values(state.groups).some((g) => g.name === n)) return { events: [], label: "", error: `「${n}」はもうあります` };
  const kind = kindIn && kindIn !== "common" ? kindIn : groupKindOf(n);
  const existing = Object.values(state.groups);
  const common = existing.find((g) => g.kind === "common");
  const others = existing.filter((g) => g.kind !== "common");
  const sortOrder = others.length > 0 ? Math.max(...others.map((g) => g.sortOrder)) + 1 : 0;
  const group: Group = { id: ctx.newId(), name: n, kind, sortOrder };
  const events: Event[] = [{ ...metaOf(ctx), type: "group.upsert", group }];
  // 共通はいちばん後ろのまま
  if (common && common.sortOrder <= sortOrder) events.push({ ...metaOf(ctx), type: "group.upsert", group: { ...common, sortOrder: sortOrder + 1 } });

  const tplGroups = [...template.groups].sort((a, b) => a.sortOrder - b.sortOrder).filter((g) => g.kind !== "common");
  const src = tplGroups.find((g) => g.kind === kind) ?? tplGroups[0];
  if (!src) return { events, label: `グループ「${n}」を足しました` };

  // 番を写す
  const slotFor = new Map<ID, ID>();
  const token = shortName(src.name);
  const newSlots: RoleSlot[] = [];
  for (const sl of template.roleSlots) {
    if (sl.groupId !== src.id) continue;
    // 雛形の短い名前を含む番は置き換え（夜勤東 → 夜勤3階）、ほかは後ろに添える（早番A（3階））
    const renamed = token && sl.name.includes(token) ? sl.name.replace(token, n) : `${sl.name}（${n}）`;
    const { leaderRank: _lr, ...rest } = sl;
    void _lr;
    const slot: RoleSlot = { ...rest, id: ctx.newId(), name: renamed, groupId: group.id, sortOrder: sl.sortOrder + sortOrder * 0.01 };
    // 同じ名前の番が既にあれば、名前の後ろに種類を添えて見分ける
    if (Object.values(state.roleSlots).some((x) => x.name === slot.name)) slot.name = `${slot.name}（${n}）`;
    newSlots.push(slot);
    slotFor.set(sl.id, slot.id);
    events.push({ ...metaOf(ctx), type: "roleSlot.upsert", roleSlot: slot });
  }

  // 業務表の枠を写す（施設の業務表のうち、雛形と同じ ID のもの）
  const slotGroup = new Map(template.roleSlots.map((x) => [x.id, x.groupId]));
  const mapSlots = (ids: ID[]): ID[] =>
    [...new Set(ids.map((sid) => (slotGroup.get(sid) === src.id ? slotFor.get(sid) : state.roleSlots[sid] ? sid : undefined)).filter((x): x is ID => Boolean(x)))];
  const covering = (startMin: number, endMin: number): ID[] => newSlots.filter((s) => s.defaultStartMin <= startMin && endMin <= s.defaultEndMin).map((s) => s.id);
  let added = 0;
  for (const tp of template.patterns) {
    const mine = state.patterns[tp.id];
    if (!mine) continue;
    const items: DayPatternItem[] = [];
    for (const it of tp.items) {
      if (it.groupId !== src.id) continue;
      let src2 = it;
      if (it.targetRule === "residents") {
        const tpl = template.templates.find((x) => x.id === it.templateId);
        if (tpl && tpl.targetMode === "group" && /入浴/.test(tpl.name)) {
          src2 = { ...it, targetRule: "allInGroup", residentIds: undefined, routineId: it.routineId ?? `rt-${it.id}` };
        } else continue;
      }
      let slotIds = mapSlots(src2.slotIds);
      if (slotIds.length === 0 && src2.slotIds.length > 0) slotIds = covering(src2.startMin, src2.endMin);
      items.push({
        ...src2,
        id: `${it.id}-${group.id}`,
        groupId: group.id,
        slotIds,
        ...(src2.routineId ? { routineId: `${src2.routineId}-${group.id}` } : {}),
      });
    }
    if (items.length === 0) continue;
    added += items.length;
    events.push({ ...metaOf(ctx), type: "pattern.upsert", pattern: { ...mine, items: [...mine.items, ...items] } });
  }
  const names = newSlots.map((x) => x.name).join("、");
  const kindWord = kind === "unit" ? "ユニット" : "フロア";
  const label = `グループ「${n}」を${kindWord}として足しました（番 ${newSlots.length}${names ? `: ${names}` : ""}・業務表の枠 ${added}。まだ作っていない日の時間割から出ます。作ってある日は変わりません）`;
  return { events, label };
}

/** グループの名前を直す。名前を含む番も付け直す */
export function renameGroupEvents(state: State, groupId: ID, name: string, ctx: EventContext): MasterResult {
  const g = state.groups[groupId];
  const n = squash(name);
  if (!g) return { events: [], label: "", error: "そのグループは見つかりません" };
  if (!n) return { events: [], label: "", error: "グループの名前を入れてください" };
  if (n === g.name) return { events: [], label: "" };
  if (Object.values(state.groups).some((x) => x.name === n && x.id !== groupId)) return { events: [], label: "", error: `「${n}」はもうあります` };
  // 種類（ユニット／フロア）は名前を変えても変えない（0016。種類は足すときに選ぶ）
  const events: Event[] = [{ ...metaOf(ctx), type: "group.upsert", group: { ...g, name: n } }];
  const oldShort = shortName(g.name);
  const newShort = shortName(n);
  const kept: string[] = [];
  for (const sl of Object.values(state.roleSlots)) {
    if (sl.groupId !== groupId) continue;
    const next = sl.name.includes(g.name) ? sl.name.replace(g.name, n) : oldShort && sl.name.includes(oldShort) ? sl.name.replace(oldShort, newShort) : null;
    if (next && next !== sl.name && !Object.values(state.roleSlots).some((x) => x.name === next && x.id !== sl.id)) {
      events.push({ ...metaOf(ctx), type: "roleSlot.upsert", roleSlot: { ...sl, name: next } });
    } else kept.push(sl.name);
  }
  if (kept.length > 0) return { events, label: `グループ「${g.name}」を「${n}」にしました（番の名前はそのまま: ${kept.join("、")}。下の番の欄で直せます）` };
  return { events, label: `グループ「${g.name}」を「${n}」にしました` };
}

/** グループを外す。所属が残る間は外せない。そのグループの番と業務表の枠も一緒に外す */
export function removeGroupEvents(state: State, groupId: ID, ctx: EventContext): MasterResult {
  const g = state.groups[groupId];
  if (!g) return { events: [], label: "", error: "そのグループは見つかりません" };
  if (g.kind === "common") return { events: [], label: "", error: "「共通」は外せません" };
  const m = groupMembers(state, groupId);
  if (m.residents > 0 || m.staff > 0) {
    return { events: [], label: "", error: `${g.name}には利用者 ${m.residents}人・職員 ${m.staff}人が所属しています。先に利用者の画面（「1 人ずつ足す・直す」）と、下の職員の欄（名前を押して「所属」）で所属を変えてください` };
  }
  const events: Event[] = [];
  for (const p of Object.values(state.patterns)) {
    if (!p.items.some((it) => it.groupId === groupId)) continue;
    events.push({ ...metaOf(ctx), type: "pattern.upsert", pattern: { ...p, items: p.items.filter((it) => it.groupId !== groupId) } });
  }
  for (const sl of Object.values(state.roleSlots)) {
    if (sl.groupId === groupId) events.push({ ...metaOf(ctx), type: "roleSlot.remove", id: sl.id });
  }
  events.push({ ...metaOf(ctx), type: "group.remove", id: groupId });
  return { events, label: `グループ「${g.name}」を外しました（番と業務表の枠も）` };
}

export interface RoleSlotInput {
  id?: ID;
  name: string;
  startMin: number;
  endMin: number;
  groupId?: ID;
  /** リーダーの順（1 が先）。無ければリーダーの番ではない */
  leaderRank?: number;
}

/** 番を足す・直す。時刻を変えても、入れてある勤務表は変えない */
export function upsertRoleSlotEvents(state: State, input: RoleSlotInput, ctx: EventContext): MasterResult {
  const n = squash(input.name);
  if (!n) return { events: [], label: "", error: "番の名前を入れてください（早番A など）" };
  // 終わりが開始より前（17:00／9:00）なら翌日として受ける
  const toNext = input.endMin <= input.startMin && input.endMin < 24 * 60;
  input = { ...input, endMin: toNext ? input.endMin + 24 * 60 : input.endMin };
  if (!(input.startMin >= 0 && input.startMin < 24 * 60 && input.endMin > input.startMin && input.endMin <= 2879)) return { events: [], label: "", error: "時刻は 開始 < 終わり（翌日は 翌9:00 のように）で入れてください" };
  const prev = input.id ? state.roleSlots[input.id] : undefined;
  if (input.id && !prev) return { events: [], label: "", error: "その番は見つかりません" };
  if (Object.values(state.roleSlots).some((s) => s.name === n && s.id !== input.id)) return { events: [], label: "", error: `番「${n}」はもうあります` };
  if (input.groupId && !state.groups[input.groupId]) return { events: [], label: "", error: "グループが見つかりません" };
  const sortOrder = prev?.sortOrder ?? Math.max(-1, ...Object.values(state.roleSlots).map((s) => s.sortOrder)) + 1;
  const slot: RoleSlot = {
    ...(prev ?? {}),
    id: prev?.id ?? ctx.newId(),
    name: n,
    defaultStartMin: input.startMin,
    defaultEndMin: input.endMin,
    sortOrder,
  };
  if (input.groupId) slot.groupId = input.groupId;
  else delete slot.groupId;
  if (input.leaderRank) slot.leaderRank = input.leaderRank;
  else delete slot.leaderRank;
  const hours = Math.round(((input.endMin - input.startMin) / 60) * 10) / 10;
  const note = toNext ? `。終わりを ${fmtMin(input.endMin)} として入れました（${hours} 時間）` : hours > 16 ? `。${hours} 時間の番です。時刻を確かめてください` : "";
  const label = prev ? `番「${n}」を直しました（入れてある勤務表の時刻はそのままです${note}）` : `番「${n}」を足しました${note ? `（${note.slice(1)}）` : ""}`;
  return { events: [{ ...metaOf(ctx), type: "roleSlot.upsert", roleSlot: slot }], label };
}

/** 番を外す。今日以降の勤務表か業務表に使われていれば外せない */
export function removeRoleSlotEvents(state: State, slotId: ID, today: DateKey, ctx: EventContext): MasterResult {
  const sl = state.roleSlots[slotId];
  if (!sl) return { events: [], label: "", error: "その番は見つかりません" };
  const rosterDays = new Set(Object.values(state.roster).filter((e) => e.slotId === slotId && e.date >= today).map((e) => e.date)).size;
  const patterns = Object.values(state.patterns).filter((p) => p.items.some((it) => it.slotIds.includes(slotId)));
  if (rosterDays > 0 || patterns.length > 0) {
    const why = [rosterDays > 0 ? `今日以降の勤務表 ${rosterDays}日` : "", patterns.length > 0 ? `業務表「${patterns.map((p) => p.name).join("・")}」` : ""].filter(Boolean).join("と");
    const next =
      patterns.length > 0
        ? "使わなくなった番は、名前を変えて残してください（業務表から外すには、ボードでその番の枠を外してから ⋯ →「今日を業務表として保存」）"
        : "先に勤務表のその日の番を選び直してください";
    return { events: [], label: "", error: `番「${sl.name}」は${why}で使われているので外せません。${next}` };
  }
  return { events: [{ ...metaOf(ctx), type: "roleSlot.remove", id: slotId }], label: `番「${sl.name}」を外しました` };
}

/** 番が使われている場所（画面の一覧の補足） */
export function roleSlotUsage(state: State, slotId: ID, today: DateKey): { rosterDays: number; patterns: number } {
  return {
    rosterDays: new Set(Object.values(state.roster).filter((e) => e.slotId === slotId && e.date >= today).map((e) => e.date)).size,
    patterns: Object.values(state.patterns).filter((p) => p.items.some((it) => it.slotIds.includes(slotId))).length,
  };
}
