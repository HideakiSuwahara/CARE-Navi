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
  /** 姓と名の間に空白がない（「部屋番号＋姓」などで姓だけを出せない） */
  noSpace?: boolean;
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
    const cells = raw.split(SPLIT).map((c) => c.trim());
    const [name = "", role = "", tags = "", phone = ""] = cells;
    // 表計算の見出し行（氏名, 職種 …）は飛ばす
    if (/^(氏名|名前|職員名)$/.test(name)) return;
    if (!name) {
      out.errors.push({ line, reason: "名前がありません" });
      return;
    }
    if (cells.length === 1) {
      out.errors.push({ line, reason: "区切りが見つかりません（カンマかタブで「名前, 職種」と区切ってください）" });
      return;
    }
    if (/^[0-9０-９-]+$/.test(name)) {
      out.errors.push({ line, reason: "1列目が数字です（職員番号の列は外して、名前から始めてください）" });
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
      ...(displayName.includes(" ") ? {} : { noSpace: true }),
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
  /** 姓と名の間に空白がない行の数（取り込むが、姓だけを出せない） */
  noSpace: number;
  counts: { groups: number; residents: number; staff: number };
  /** グループごとに当てはめた雛形（画面に1行ずつ出す） */
  mapping: { group: string; kind: "従来型" | "ユニット" }[];
  /** 対象の方を決めていた業務（雛形の利用者向け）で、写さなかったもの */
  skippedPersonal: string[];
  events: Event[];
}

/** グループの名前から種類を決める（「ユニット」を含めばユニット、ほかはフロア） */
function groupKind(name: string): Group["kind"] {
  return /ユニット/.test(name) ? "unit" : "floor";
}

/** 雛形のグループの短い名前（「東フロア」→「東」、「さくらユニット」→「さくら」） */
function shortName(name: string): string {
  return name.replace(/フロア|ユニット/g, "").trim() || name;
}

/**
 * 自分の施設を作るイベント列。雛形（サンプル）の業務の種類・番・業務表を写す。
 * - グループは種類で当てはめる: フロア → 雛形の従来型（フロア）、ユニット → 雛形のユニット。同じ種類が複数あれば、それぞれに写す。
 * - そのグループの番は、グループの名前で付け直す（「夜勤東」→「夜勤 2階」）。
 * - 業務の種類から、雛形の施設に固有の文（相談先・物品の場所・場所）を外す。困ったらは「いまのリーダー」が出る。
 * - 対象の方を決めていた業務（雛形の利用者向け）は写さない。利用者画面の24時間シートから足す。
 * 当日の出勤者・時間割は作らない（ボードの「今日の時間割を作る」で作る）。
 */
export function buildOwnFacility(input: OwnFacilityInput, template: SeedData, ctx: EventContext): OwnFacilityResult {
  const problems: string[] = [];
  const name = input.name.trim();
  const groupNames = [...new Set(input.groupsText.split(/\r?\n/).map((x) => x.trim()).filter(Boolean))];
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

  // 入れたグループ → 雛形のグループ（同じ種類の最初。無ければ雛形の最初のグループ）
  const srcOf = new Map<ID, Group>();
  for (const g of groups) {
    const src = tplOthers.find((t) => t.kind === g.kind) ?? tplOthers[0];
    if (src) srcOf.set(g.id, src);
  }
  const targetsOf = (tplGroupId?: ID): Group[] => (tplGroupId ? groups.filter((g) => srcOf.get(g.id)?.id === tplGroupId) : []);

  // 番: グループ付きの番は、当てはめたグループごとに写して名前を付け直す
  const roleSlots: SeedData["roleSlots"] = [];
  const slotFor = new Map<string, ID>(); // `${tplSlotId}|${userGroupId}` → 新しい番
  for (const sl of template.roleSlots) {
    if (!sl.groupId || sl.groupId === tplCommon?.id) {
      const { groupId: _g, ...rest } = sl;
      void _g;
      roleSlots.push(sl.groupId ? { ...rest, groupId: common.id } : rest);
      continue;
    }
    const src = tplOthers.find((t) => t.id === sl.groupId);
    const targets = targetsOf(sl.groupId);
    targets.forEach((g, i) => {
      const id = targets.length === 1 ? sl.id : `${sl.id}-${i + 1}`;
      const token = src ? shortName(src.name) : "";
      const renamed = token && sl.name.includes(token) ? sl.name.replace(token, ` ${g.name}`).trim() : targets.length > 1 ? `${sl.name}（${g.name}）` : sl.name;
      roleSlots.push({ ...sl, id, name: renamed, groupId: g.id, sortOrder: sl.sortOrder + i * 0.01 });
      slotFor.set(`${sl.id}|${g.id}`, id);
    });
  }
  const slotGroup = new Map(template.roleSlots.map((x) => [x.id, x.groupId]));
  /** 業務表の項目の番を写す。グループ付きの番は、その項目のグループ（共通なら最初に当てはめたグループ）の番へ */
  const mapSlots = (ids: ID[], userGroup?: Group): ID[] =>
    ids
      .map((sid) => {
        const sg = slotGroup.get(sid);
        if (!sg || sg === tplCommon?.id) return sid;
        const g = userGroup && srcOf.get(userGroup.id)?.id === sg ? userGroup : targetsOf(sg)[0];
        return g ? slotFor.get(`${sid}|${g.id}`) : undefined;
      })
      .filter((x): x is ID => Boolean(x));

  // 業務の種類: 雛形の施設に固有の文を外す
  const templates = template.templates.map((t) => {
    const { contact: _c, supplies: _s, place: _p, ...rest } = t;
    void _c;
    void _s;
    void _p;
    return rest;
  });

  const skipped = new Set<string>();
  const patterns = template.patterns.map((p) => ({
    ...p,
    items: p.items.flatMap((it) => {
      if (it.targetRule === "residents") {
        const tpl = template.templates.find((x) => x.id === it.templateId);
        if (tpl) skipped.add(tpl.name);
        return [];
      }
      if (!it.groupId || it.groupId === tplCommon?.id) {
        return [{ ...it, groupId: it.groupId ? common.id : undefined, slotIds: mapSlots(it.slotIds) }];
      }
      const targets = targetsOf(it.groupId);
      // 同じ雛形を複数のグループに写すときは、日課の印もグループごとに分ける（1階の時刻を変えても2階は変わらない）
      return targets.map((g, i) => ({
        ...it,
        id: targets.length === 1 ? it.id : `${it.id}-${i + 1}`,
        groupId: g.id,
        slotIds: mapSlots(it.slotIds, g),
        ...(it.routineId && targets.length > 1 ? { routineId: `${it.routineId}-${i + 1}` } : {}),
      }));
    }),
  }));

  // 利用者・職員の貼り付け（グループが決まってから読む）
  const scratch: State = { ...emptyState(), groups: Object.fromEntries([...groups, common].map((g) => [g.id, g])) };
  const rp = parseResidentPaste(scratch, input.residentsText, groups.length === 1 ? groups[0].id : undefined);
  const sp = parseStaffPaste(scratch, input.staffText);
  const residents: Resident[] = rp.residents.map((r) => ({ id: ctx.newId(), displayName: r.displayName, surname: r.surname, groupId: r.groupId, room: r.room }));
  const staff: Staff[] = sp.staff.map((r) => ({ id: ctx.newId(), displayName: r.displayName, surname: r.surname, role: r.role, tags: r.tags, ...(r.phone ? { phone: r.phone } : {}) }));
  const noSpace = rp.residents.filter((r) => !r.displayName.includes(" ")).length + sp.staff.filter((r) => r.noSpace).length;

  const seed: SeedData = {
    facility,
    groups: [...groups, common],
    residents,
    staff,
    roleSlots,
    templates,
    patterns,
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
    noSpace,
    counts: { groups: groups.length, residents: residents.length, staff: staff.length },
    mapping: groups.map((g) => ({ group: g.name, kind: g.kind === "unit" ? "ユニット" : "従来型" })),
    skippedPersonal: [...skipped],
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

/** ふだんの設定（表示名・初回の職員の警告）を変えるイベント */
export function settingsEvent(state: State, patch: Partial<Pick<FacilitySettings, "residentDisplayMode" | "firstTimerOnlyWarning">>, ctx: EventContext): Event | null {
  const f = state.facility;
  if (!f) return null;
  return { ...metaOf(ctx), type: "facility.set", facility: { ...f, settings: { ...f.settings, ...patch } } };
}
