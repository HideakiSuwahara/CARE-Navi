/**
 * ケアナビ ドメイン型
 *
 * 中心の考え方: 「人に仕事を積む」のではなく「必要な業務を棚卸しして、そこに人を当てる」。
 * - 業務予定（TaskInstance）が主語。利用者（対象）と職員（担当）はそこに関連付く。
 * - 個別（対象1名）・一括（対象複数）・共通（対象なし）は同じ型で表す。
 * - 一日の型（DayPattern）は役割枠（RoleSlot）に業務を束ねる。朝は出勤者に役割を付けるだけで
 *   全枠に担当が付く。
 * - 状態は操作イベント（Event）の列から組み立てる。Undo は打ち消しイベント。
 *
 * 表現の規則（UI でも守る）:
 * - 未割り当て ≠ 人手不足。「担当未定」「担当あと n 人」とだけ言う。
 * - 時間が過ぎても実施中・完了と推定しない。
 * - 区分（Category）はラベル。可否は担当条件（requiredTags）で施設が決める。
 * - 数字は業務に付ける。職員個人の区分別時間は出さない。
 */

export type ID = string;

/** 業務日 0:00 起点の分。翌日分は 1440 以上（最大 2879）。例: 翌 2:00 = 1560 */
export type Minutes = number;

/** YYYY-MM-DD（業務日。夜勤帯の業務は、その夜勤が始まった業務日に属する） */
export type DateKey = string;

export const MINUTES_PER_DAY = 1440;
export const MAX_MINUTES = 2880;

// ---------------------------------------------------------------------------
// 施設・設定
// ---------------------------------------------------------------------------

export type CategoryKind = "core" | "noncore" | "other";

/** 業務区分。名称は施設が編集できる。kind は集計のための固定キー。 */
export interface Category {
  id: ID;
  name: string;
  kind: CategoryKind;
}

export type ResidentDisplayMode = "full" | "roomAndSurname" | "roomOnly";

export interface FacilitySettings {
  /** 配置チェックの扱い。二重登録は設定に関わらず常に禁止。 */
  checkMode: "warn" | "block";
  /** 手元画面（マイナビ）での利用者の表示名。ボード（施設PC）は常にフルネーム。 */
  residentDisplayMode: ResidentDisplayMode;
  /** 「初回の方だけの配置です」の警告を出すか */
  firstTimerOnlyWarning: boolean;
  /** ボードの既定表示範囲（分）。既定 06:00–22:00 */
  boardStartMin: Minutes;
  boardEndMin: Minutes;
  categories: Category[];
}

export interface Facility {
  id: ID;
  name: string;
  settings: FacilitySettings;
}

export type GroupKind = "unit" | "floor" | "common" | "other";

/** 管理グループ（ユニット・フロア・共通など） */
export interface Group {
  id: ID;
  name: string;
  kind: GroupKind;
  sortOrder: number;
}

// ---------------------------------------------------------------------------
// 利用者・職員・役割枠
// ---------------------------------------------------------------------------

export interface Resident {
  id: ID;
  /** 例: 「田中 ハナ」 */
  displayName: string;
  /** 例: 「田中」。表示名モード roomAndSurname で使う */
  surname: string;
  groupId: ID;
  room: string;
}

export interface Staff {
  id: ID;
  displayName: string;
  surname: string;
  /** 自由ラベル。例: 介護福祉士／介護職員／介護助手／看護師／スポット */
  role: string;
  /** 担当条件タグ。例: 介護福祉士、喀痰吸引、入浴担当可、施設オリエン済 */
  tags: string[];
  homeGroupId?: ID;
  /** 施設内の連絡先（PHS・内線）。任意。業務詳細の「困ったら」に出す */
  phone?: string;
}

/**
 * 役割枠。例: 早番A、日勤B、遅番、夜勤(東)、介護助手、看護、スポット。
 * 一日の型の業務はここに束ねる。役割枠は既定の勤務時間を持つ。
 */
export interface RoleSlot {
  id: ID;
  name: string;
  defaultStartMin: Minutes;
  defaultEndMin: Minutes;
  groupId?: ID;
  sortOrder: number;
}

// ---------------------------------------------------------------------------
// 業務の型・一日の型
// ---------------------------------------------------------------------------

export type TaskKind = "care" | "break";
export type TargetMode = "individual" | "group" | "none";

/** 業務の型（定義）。当日の予定（TaskInstance）とは分ける。 */
export interface TaskTemplate {
  id: ID;
  name: string;
  /** break は休憩。区分の集計に入れない。 */
  kind: TaskKind;
  categoryId?: ID;
  targetMode: TargetMode;
  defaultDurationMin: Minutes;
  defaultHeadcount: number;
  requiredTags: string[];
  place?: string;
  /** あなたにお願いすること（担当範囲） */
  scopeNote?: string;
  /** お願いしないこと */
  outOfScopeNote?: string;
  /** 施設固有の短い手順 */
  procedure: string[];
  /** 物品の場所 */
  supplies?: string;
  /** 困ったときの相談先 */
  contact?: string;
}

export type TargetRule = "allInGroup" | "residents" | "none";

export interface DayPatternItem {
  id: ID;
  templateId: ID;
  startMin: Minutes;
  endMin: Minutes;
  groupId?: ID;
  targetRule: TargetRule;
  /** targetRule = residents のとき */
  residentIds?: ID[];
  headcount: number;
  /** 束ねる役割枠。型を当てると、当日この役割を持つ出勤者が担当になる。 */
  slotIds: ID[];
  /**
   * 施設の日課（利用者にかかわる業務）の印。同じ日課は業務表が違っても同じ routineId を持つ
   * （例: 平日と入浴日の「東フロア 起床介助」は同じ "rt-wake-east"）。
   * 利用者の24時間シートはこの ID で日課ごとの調整（時刻の変更・なし）を持つ。決定記録 0004
   */
  routineId?: string;
}

/** 一日の型（役割表の中身）。例: 平日、入浴日、日曜 */
export interface DayPattern {
  id: ID;
  name: string;
  items: DayPatternItem[];
  /** この業務表を既定で選ぶ曜日（0=日〜6=土）。朝の「今日の時間割を作る」で使う */
  weekdays?: number[];
}

// ---------------------------------------------------------------------------
// 当日: 出勤者・業務予定・対象者・担当
// ---------------------------------------------------------------------------

/** 今日の出勤者（勤務予定）。役割枠が勤務時間を与え、個別に直せる。 */
export interface RosterEntry {
  id: ID;
  date: DateKey;
  staffId: ID;
  slotId?: ID;
  startMin: Minutes;
  endMin: Minutes;
  /** 初回の方（応援・スポットの初日など）。属性ではなく当日の印。 */
  firstTimer: boolean;
  /** 欠勤・早退などで本日は配置対象外 */
  absent: boolean;
  /** 朝の下書きで先週の同じ曜日から写した行（その日付）。画面に「先週 10/27 から」と出し、確かめてもらう */
  carriedFrom?: DateKey;
}

export type TaskStatus = "planned" | "cancelled";

/** 業務予定。個別・一括・共通・休憩をすべて同じ型で表す。 */
export interface TaskInstance {
  id: ID;
  date: DateKey;
  templateId?: ID;
  name: string;
  kind: TaskKind;
  categoryId?: ID;
  targetMode: TargetMode;
  groupId?: ID;
  startMin: Minutes;
  endMin: Minutes;
  place?: string;
  /** 施設が決めた必要人数（予定値）。対象者数から推定しない。 */
  headcount: number;
  requiredTags: string[];
  /** 型から作られた場合に束ねられていた役割枠 */
  slotIds: ID[];
  scopeNote?: string;
  outOfScopeNote?: string;
  procedure?: string[];
  supplies?: string;
  contact?: string;
  note?: string;
  status: TaskStatus;
  /** pattern = 一日の型から作られた予定。省略は手で足した予定（型を当て直しても消さない） */
  origin?: "pattern" | "manual";
  /** 施設の日課から作られた枠なら、その日課の ID */
  routineId?: string;
  /** 一括の枠の中で、標準と違う時刻の方の時刻（residentId → 開始の分）。詳細の対象者一覧に出す */
  targetTimes?: Record<ID, Minutes>;
}

// ---------------------------------------------------------------------------
// 利用者の24時間シート（決定記録 0004）
// ---------------------------------------------------------------------------

/**
 * 24時間シートの1行。
 * - routineId あり: 施設の日課への調整。startMin/endMin を入れれば時刻の変更、skip ならその方はなし。
 *   どちらもなければ「標準どおり」（4つの項目だけを書く行）。
 * - routineId なし: その方だけの行。templateId があれば、その方の個別の枠を作る。
 *   templateId がなければ参考の行（「10:00 新聞を読む」）で、枠は作らない。
 */
export interface SheetRow {
  id: ID;
  routineId?: string;
  startMin?: Minutes;
  endMin?: Minutes;
  skip?: boolean;
  templateId?: ID;
  /** その方だけの行の名前（templateId がないとき） */
  label?: string;
  /** その方だけの行を入れる曜日（0=日〜6=土）。省略は毎日 */
  weekdays?: number[];
  /** 生活リズム（その時間の過ごし方） */
  rhythm?: string;
  /** 意向・好み */
  preference?: string;
  /** 自分でできること */
  canDo?: string;
  /** サポートが必要なこと（担当の人の手元画面に出す） */
  support?: string;
}

export interface ResidentSheet {
  residentId: ID;
  rows: SheetRow[];
  /** 最終更新（ISO）。シートの印刷に出す */
  updatedAt?: string;
}

/** 一括業務の対象者を明示保存する（人数だけ保存しない） */
export interface TaskTarget {
  taskId: ID;
  residentId: ID;
}

export interface Assignment {
  id: ID;
  taskId: ID;
  staffId: ID;
}

export interface DayMeta {
  date: DateKey;
  appliedPatternId?: ID;
  /** 最終更新（時刻のみを見出しに出す。誰が変えたかは履歴で見る） */
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// 状態
// ---------------------------------------------------------------------------

export interface State {
  facility: Facility | null;
  groups: Record<ID, Group>;
  residents: Record<ID, Resident>;
  staff: Record<ID, Staff>;
  roleSlots: Record<ID, RoleSlot>;
  templates: Record<ID, TaskTemplate>;
  patterns: Record<ID, DayPattern>;
  roster: Record<ID, RosterEntry>;
  tasks: Record<ID, TaskInstance>;
  /** taskId → residentIds */
  targets: Record<ID, ID[]>;
  assignments: Record<ID, Assignment>;
  days: Record<DateKey, DayMeta>;
  /** residentId → 24時間シート */
  sheets: Record<ID, ResidentSheet>;
}

export function emptyState(): State {
  return {
    facility: null,
    groups: {},
    residents: {},
    staff: {},
    roleSlots: {},
    templates: {},
    patterns: {},
    roster: {},
    tasks: {},
    targets: {},
    assignments: {},
    days: {},
    sheets: {},
  };
}

// ---------------------------------------------------------------------------
// シード（架空施設）: 型を当てる前の素材。当日の業務予定は pattern から作る。
// ---------------------------------------------------------------------------

export interface SeedData {
  facility: Facility;
  groups: Group[];
  residents: Resident[];
  staff: Staff[];
  roleSlots: RoleSlot[];
  templates: TaskTemplate[];
  patterns: DayPattern[];
  /** 日付ごとの出勤者 */
  roster: RosterEntry[];
  /** 型に含まれない当日限りの個別予定（受診の付き添いなど）。対象者は targets で */
  extraTasks: TaskInstance[];
  /** extraTasks の対象者 */
  extraTargets: TaskTarget[];
  /** 日付ごとに当てる型 */
  dayPatterns: { date: DateKey; patternId: ID }[];
  /** 利用者の24時間シート（省略可。省略した方は全員が標準どおり） */
  sheets?: ResidentSheet[];
}

// ---------------------------------------------------------------------------
// 配置チェック
// ---------------------------------------------------------------------------

export type IssueCode =
  | "duplicate" // 同じ職員を同じ業務へ二重登録（常に禁止）
  | "overlap" // 他の業務と時間が重なる
  | "noRoster" // 本日の勤務予定がない
  | "offShift" // 勤務時間外
  | "absent" // 欠勤・早退
  | "onBreak" // 休憩と重なる
  | "missingTags" // 担当条件を満たさない
  | "firstTimerOnly"; // 初回の方だけの配置になる

export type IssueSeverity = "block" | "warn";

export interface Issue {
  code: IssueCode;
  severity: IssueSeverity;
  /** 短い日本語の理由。例: 「10:00〜10:30 の『排泄介助 田中様』と重なります」 */
  message: string;
  relatedTaskIds?: ID[];
}

/** 充足バッジ。label は UI にそのまま出す文字。 */
export interface HeadcountStatus {
  required: number;
  assigned: number;
  /** required - assigned（負なら多め） */
  gap: number;
  level: "unassigned" | "short" | "ok" | "over";
  label: string;
}
