/**
 * 設定（PC）の純関数。docs/screens.md §3
 * - 「自分の施設で始める」: 施設の名前・グループ・利用者の貼り付け・職員の貼り付けから、施設を作るイベント列を作る。
 *   業務の種類（約20種）・番・業務表（従来型／ユニット）はサンプルの雛形から写す（グループは並び順で当てはめる）。
 * - 職員の貼り付け: 1行1人「名前, 職種, 担当条件[任意], PHS[任意]」。区切りはカンマ・タブ・全角カンマ。
 * - 失敗した行は行番号と理由を返し、ほかの行は取り込む。
 */

import type { Event } from "./events.ts";
import { seedToEvents } from "./loadSeed.ts";
import { metaOf, type EventContext } from "./pattern.ts";
import { parseResidentPaste } from "./residentsIO.ts";
import { emptyState, type Facility, type FacilitySettings, type Group, type ID, type Resident, type SeedData, type Staff, type State } from "./types.ts";

const SPLIT = /[,\t，、]/;

export interface PastedStaff {
  line: number;
  displayName: string;
  surname: string;
  role: string;
  tags: string[];
  phone?: string;
}

export interface StaffPasteResult {
  staff: PastedStaff[];
  errors: { line: number; reason: string }[];
}

/** 職員の貼り付け。担当条件は「・」「/」「 」で区切る。PHS は数字とハイフン */
export function parseStaffPaste(state: State, text: string): StaffPasteResult {
  const out: StaffPasteResult = { staff: [], errors: [] };
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    if (!raw.trim()) return;
    const [name = "", role = "", tags = "", phone = ""] = raw.split(SPLIT).map((c) => c.trim());
    if (!name) {
      out.errors.push({ line, reason: "名前がありません" });
      return;
    }
    if (!role) {
      out.errors.push({ line, reason: "職種がありません（名前, 職種, 担当条件, PHS の順）" });
      return;
    }
    if (phone && !/^[0-9０-９-]+$/.test(phone)) {
      out.errors.push({ line, reason: `PHS「${phone}」は数字で書いてください` });
      return;
    }
    const displayName = name.replace(/[\s　]+/g, " ");
    const surname = displayName.split(" ")[0];
    if (Object.values(state.staff).some((s) => s.displayName === displayName) || out.staff.some((s) => s.displayName === displayName)) {
      out.errors.push({ line, reason: `${displayName}さんはすでに登録されています` });
      return;
    }
    out.staff.push({
      line,
      displayName,
      surname,
      role,
      tags: tags ? tags.split(/[・/／\s　]+/).filter(Boolean) : [],
      ...(phone ? { phone: phone.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)) } : {}),
    });
  });
  return out;
}

/** 貼り付けた職員を足すイベント（設定の「職員を貼り付け」） */
export function staffEvents(rows: PastedStaff[], ctx: EventContext): Event[] {
  return rows.map((r) => ({
    ...metaOf(ctx),
    type: "staff.upsert" as const,
    staff: { id: ctx.newId(), displayName: r.displayName, surname: r.surname, role: r.role, tags: r.tags, ...(r.phone ? { phone: r.phone } : {}) },
  }));
}

export interface OwnFacilityInput {
  name: string;
  /** 1行1つ */
  groupsText: string;
  residentsText: string;
  staffText: string;
}

export interface OwnFacilityResult {
  ok: boolean;
  /** 入力の問題（施設の名前・グループがないなど）。あれば作らない */
  problems: string[];
  /** 取り込めなかった行（ほかの行は取り込む） */
  residentErrors: { line: number; reason: string }[];
  staffErrors: { line: number; reason: string }[];
  counts: { groups: number; residents: number; staff: number };
  events: Event[];
}

/** グループの名前から種類を決める（「ユニット」を含めばユニット、ほかはフロア） */
function groupKind(name: string): Group["kind"] {
  return /ユニット/.test(name) ? "unit" : "floor";
}

/**
 * 自分の施設を作るイベント列。雛形（サンプル）の業務の種類・番・業務表を写し、
 * 雛形のグループ（共通を除く）を、入力したグループに並び順で当てはめる。当てはまらない業務表の項目は入れない。
 * 当日の出勤者・時間割は作らない（ボードの「今日の時間割を作る」で作る）。
 */
export function buildOwnFacility(input: OwnFacilityInput, template: SeedData, ctx: EventContext): OwnFacilityResult {
  const problems: string[] = [];
  const name = input.name.trim();
  const groupNames = [...new Set(input.groupsText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean))];
  if (!name) problems.push("施設の名前を入れてください");
  if (groupNames.length === 0) problems.push("グループを1つ以上入れてください（1行に1つ）");

  const facility: Facility = {
    id: ctx.newId(),
    name,
    settings: { ...(template.facility.settings as FacilitySettings) },
  };
  const tplGroups = [...template.groups].sort((a, b) => a.sortOrder - b.sortOrder);
  const tplCommon = tplGroups.find((g) => g.kind === "common");
  const tplOthers = tplGroups.filter((g) => g.kind !== "common");
  const groups: Group[] = groupNames.map((n, i) => ({ id: ctx.newId(), name: n, kind: groupKind(n), sortOrder: i }));
  const common: Group = { id: ctx.newId(), name: tplCommon?.name ?? "共通", kind: "common", sortOrder: groups.length };
  const gmap = new Map<ID, ID>();
  tplOthers.forEach((g, i) => {
    if (groups[i]) gmap.set(g.id, groups[i].id);
  });
  if (tplCommon) gmap.set(tplCommon.id, common.id);
  const mapGroup = (id?: ID) => (id ? gmap.get(id) : undefined);

  // 利用者・職員の貼り付け（グループが決まってから読む）
  const scratch: State = { ...emptyState(), groups: Object.fromEntries([...groups, common].map((g) => [g.id, g])) };
  const rp = parseResidentPaste(scratch, input.residentsText, groups.length === 1 ? groups[0].id : undefined);
  const sp = parseStaffPaste(scratch, input.staffText);
  const residents: Resident[] = rp.residents.map((r) => ({ id: ctx.newId(), displayName: r.displayName, surname: r.surname, groupId: r.groupId, room: r.room }));
  const staff: Staff[] = sp.staff.map((r) => ({ id: ctx.newId(), displayName: r.displayName, surname: r.surname, role: r.role, tags: r.tags, ...(r.phone ? { phone: r.phone } : {}) }));

  const seed: SeedData = {
    facility,
    groups: [...groups, common],
    residents,
    staff,
    roleSlots: template.roleSlots.map((s) => {
      const g = mapGroup(s.groupId);
      const { groupId: _drop, ...rest } = s;
      void _drop;
      return g ? { ...rest, groupId: g } : rest;
    }),
    templates: template.templates,
    patterns: template.patterns.map((p) => ({
      ...p,
      items: p.items
        .filter((it) => !it.groupId || mapGroup(it.groupId))
        .map((it) => ({ ...it, groupId: mapGroup(it.groupId), residentIds: it.targetRule === "residents" ? [] : it.residentIds })),
    })),
    roster: [],
    extraTasks: [],
    extraTargets: [],
    dayPatterns: [],
  };

  const ok = problems.length === 0;
  return {
    ok,
    problems,
    residentErrors: rp.errors,
    staffErrors: sp.errors,
    counts: { groups: groups.length, residents: residents.length, staff: staff.length },
    events: ok ? seedToEvents(seed, ctx) : [],
  };
}

/** 施設コード（6文字）。施設の ID から決める。認証ではない（README に本番の要件として書く） */
export function facilityCode(facilityId: string): string {
  let h = 2166136261;
  for (let i = 0; i < facilityId.length; i++) {
    h ^= facilityId.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += chars[h % chars.length];
    h = (Math.floor(h / chars.length) ^ Math.imul(h, 31)) >>> 0;
  }
  return out;
}

/** ふだんの設定（表示名・初回の方の警告）を変えるイベント */
export function settingsEvent(state: State, patch: Partial<Pick<FacilitySettings, "residentDisplayMode" | "firstTimerOnlyWarning">>, ctx: EventContext): Event | null {
  const f = state.facility;
  if (!f) return null;
  return { ...metaOf(ctx), type: "facility.set", facility: { ...f, settings: { ...f.settings, ...patch } } };
}
