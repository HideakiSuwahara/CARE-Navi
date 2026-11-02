/**
 * 架空施設「ひまわり苑」のシードデータ。
 * すべて架空の施設・利用者・職員。実在の人物・施設とは関係ない。
 *
 * - 東フロア: 従来型・20人（部屋 101–120）
 * - さくらユニット: 10人（部屋 201–210）
 * - 共通: 対象者なしの業務・休憩の置き場
 *
 * 時刻は業務日 0:00 起点の分。翌日分は 1440 以上（夜勤帯の業務は、その夜勤が始まった業務日に属する）。
 */

import type {
  DayPattern,
  DayPatternItem,
  Group,
  ID,
  Resident,
  RoleSlot,
  RosterEntry,
  SeedData,
  Staff,
  TaskInstance,
  TaskTarget,
  TaskTemplate,
} from "../types.ts";

/** 当日の h:mm を分に */
const t = (h: number, m: number = 0): number => h * 60 + m;
/** 翌日の h:mm を分に */
const nx = (h: number, m: number = 0): number => 1440 + h * 60 + m;

// ---------------------------------------------------------------------------
// 施設・グループ
// ---------------------------------------------------------------------------

const GRP_EAST = "grp-east";
const GRP_SAKURA = "grp-sakura";
const GRP_COMMON = "grp-common";

const groups: Group[] = [
  { id: GRP_EAST, name: "東フロア", kind: "floor", sortOrder: 0 },
  { id: GRP_SAKURA, name: "さくらユニット", kind: "unit", sortOrder: 1 },
  { id: GRP_COMMON, name: "共通", kind: "common", sortOrder: 2 },
];

// ---------------------------------------------------------------------------
// 利用者（30人・架空）
// ---------------------------------------------------------------------------

const r = (room: string, surname: string, given: string, groupId: ID, key: string): Resident => ({
  id: `res-${room}-${key}`,
  displayName: `${surname} ${given}`,
  surname,
  groupId,
  room,
});

const residents: Resident[] = [
  // 東フロア 101–120
  r("101", "山田", "キヨ", GRP_EAST, "yamada"),
  r("102", "松本", "ツネオ", GRP_EAST, "matsumoto"),
  r("103", "井上", "フミ", GRP_EAST, "inoue"),
  r("104", "清水", "ミツコ", GRP_EAST, "shimizu"),
  r("105", "森田", "タケシ", GRP_EAST, "morita"),
  r("106", "池田", "サチコ", GRP_EAST, "ikeda"),
  r("107", "橋本", "ヒロシ", GRP_EAST, "hashimoto"),
  r("108", "石川", "トシエ", GRP_EAST, "ishikawa"),
  r("109", "前田", "マサオ", GRP_EAST, "maeda"),
  r("110", "藤田", "ハルエ", GRP_EAST, "fujita"),
  r("111", "岡田", "シゲル", GRP_EAST, "okada"),
  r("112", "後藤", "ヨシコ", GRP_EAST, "goto"),
  r("113", "長谷川", "イサオ", GRP_EAST, "hasegawa"),
  r("114", "村上", "チヨ", GRP_EAST, "murakami"),
  r("115", "近藤", "カズオ", GRP_EAST, "kondo"),
  r("116", "石井", "テルコ", GRP_EAST, "ishii"),
  r("117", "坂本", "ノボル", GRP_EAST, "sakamoto"),
  r("118", "遠藤", "ミヨ", GRP_EAST, "endo"),
  r("119", "青木", "セツコ", GRP_EAST, "aoki"),
  r("120", "藤井", "タダシ", GRP_EAST, "fujii"),
  // さくらユニット 201–210
  r("201", "西村", "ウメ", GRP_SAKURA, "nishimura"),
  r("202", "福田", "ジロウ", GRP_SAKURA, "fukuda"),
  r("203", "田中", "ハナ", GRP_SAKURA, "tanaka"),
  r("204", "太田", "キミエ", GRP_SAKURA, "ota"),
  r("205", "小林", "ヨシオ", GRP_SAKURA, "kobayashi"),
  r("206", "三浦", "スミ", GRP_SAKURA, "miura"),
  r("207", "岡本", "マサコ", GRP_SAKURA, "okamoto"),
  r("208", "松田", "ゲンイチ", GRP_SAKURA, "matsuda"),
  r("209", "中島", "トミ", GRP_SAKURA, "nakajima"),
  r("210", "原田", "アキラ", GRP_SAKURA, "harada"),
];

const RES_TANAKA = "res-203-tanaka";
const RES_KOBAYASHI = "res-205-kobayashi";
const RES_MATSUMOTO = "res-102-matsumoto";
/** 入浴日に入浴する東フロアの6人 */
const BATH_EAST_RESIDENTS: ID[] = [
  "res-101-yamada",
  "res-103-inoue",
  "res-105-morita",
  "res-107-hashimoto",
  "res-109-maeda",
  "res-111-okada",
];
/** 夜間に体位変換を行う方 */
const REPOSITION_EAST: ID[] = ["res-101-yamada", "res-104-shimizu", "res-107-hashimoto"];
const REPOSITION_SAKURA: ID[] = [RES_TANAKA, RES_KOBAYASHI];

// ---------------------------------------------------------------------------
// 職員（12人・架空）
// ---------------------------------------------------------------------------

const s = (
  id: ID,
  surname: string,
  given: string,
  role: string,
  tags: string[],
  homeGroupId?: ID,
  phone?: string,
): Staff => ({
  id,
  displayName: `${surname} ${given}`,
  surname,
  role,
  tags,
  ...(homeGroupId ? { homeGroupId } : {}),
  ...(phone ? { phone } : {}),
});

const STF_SATO = "stf-sato";
const STF_TAKAHASHI = "stf-takahashi";
const STF_SUZUKI = "stf-suzuki";
const STF_ITO = "stf-ito";
const STF_YAMAMOTO = "stf-yamamoto";
const STF_OGAWA = "stf-ogawa";
const STF_NAKAMURA = "stf-nakamura";
const STF_KIMURA = "stf-kimura";
const STF_KATO = "stf-kato";
const STF_WATANABE = "stf-watanabe";
const STF_SAITO = "stf-saito";
const STF_NOGUCHI = "stf-noguchi";

const staff: Staff[] = [
  s(STF_SATO, "佐藤", "みき", "介護福祉士", ["介護福祉士", "入浴担当可"], GRP_EAST, "201"),
  s(STF_TAKAHASHI, "高橋", "けんた", "介護職員", ["入浴担当可"], GRP_EAST, "202"),
  s(STF_SUZUKI, "鈴木", "あやか", "介護職員", ["入浴担当可"], GRP_EAST, "203"),
  s(STF_ITO, "伊藤", "だいき", "介護職員", ["入浴担当可"], GRP_EAST, "204"),
  s(STF_YAMAMOTO, "山本", "ゆうこ", "介護福祉士", ["介護福祉士", "入浴担当可"], GRP_EAST, "205"),
  s(STF_OGAWA, "小川", "なつみ", "介護職員", ["入浴担当可"], GRP_SAKURA, "206"),
  s(STF_NAKAMURA, "中村", "さおり", "看護師", ["看護師"], undefined, "210"),
  s(STF_KIMURA, "木村", "しょう", "介護職員", ["入浴担当可"], GRP_EAST, "207"),
  s(STF_KATO, "加藤", "ゆい", "スポット", []),
  s(STF_WATANABE, "渡辺", "さとし", "介護助手", ["入浴担当可"]),
  s(STF_SAITO, "斉藤", "りく", "介護職員", ["入浴担当可"], GRP_EAST, "208"),
  s(STF_NOGUCHI, "野口", "ちえ", "介護福祉士", ["介護福祉士"], GRP_SAKURA, "209"),
];

// ---------------------------------------------------------------------------
// 役割枠
// ---------------------------------------------------------------------------

const SLOT_HAYABAN_A = "slot-hayaban-a";
const SLOT_HAYABAN_B = "slot-hayaban-b";
const SLOT_NIKKIN_A = "slot-nikkin-a";
const SLOT_NIKKIN_B = "slot-nikkin-b";
const SLOT_NIKKIN_C = "slot-nikkin-c";
const SLOT_NIKKIN_SAKURA = "slot-nikkin-sakura";
const SLOT_OSOBAN = "slot-osoban";
const SLOT_YAKIN_EAST = "slot-yakin-east";
const SLOT_YAKIN_SAKURA = "slot-yakin-sakura";
const SLOT_JOSHU = "slot-kaigo-joshu";
const SLOT_KANGO = "slot-kango";
const SLOT_SPOT_PM = "slot-spot-pm";

const roleSlots: RoleSlot[] = [
  { id: SLOT_HAYABAN_A, name: "早番A", defaultStartMin: t(7), defaultEndMin: t(16), groupId: GRP_EAST, sortOrder: 0 },
  { id: SLOT_HAYABAN_B, name: "早番B", defaultStartMin: t(7), defaultEndMin: t(16), groupId: GRP_EAST, sortOrder: 1 },
  { id: SLOT_NIKKIN_A, name: "日勤A", defaultStartMin: t(9), defaultEndMin: t(18), groupId: GRP_EAST, sortOrder: 2 },
  { id: SLOT_NIKKIN_B, name: "日勤B", defaultStartMin: t(9), defaultEndMin: t(18), groupId: GRP_EAST, sortOrder: 3 },
  { id: SLOT_NIKKIN_C, name: "日勤C", defaultStartMin: t(9), defaultEndMin: t(18), groupId: GRP_EAST, sortOrder: 4 },
  { id: SLOT_NIKKIN_SAKURA, name: "日勤さくら", defaultStartMin: t(9), defaultEndMin: t(18), groupId: GRP_SAKURA, sortOrder: 5 },
  { id: SLOT_OSOBAN, name: "遅番", defaultStartMin: t(11), defaultEndMin: t(20), groupId: GRP_EAST, sortOrder: 6 },
  { id: SLOT_YAKIN_EAST, name: "夜勤東", defaultStartMin: t(17), defaultEndMin: nx(9), groupId: GRP_EAST, sortOrder: 7 },
  { id: SLOT_YAKIN_SAKURA, name: "夜勤さくら", defaultStartMin: t(17), defaultEndMin: nx(9), groupId: GRP_SAKURA, sortOrder: 8 },
  { id: SLOT_JOSHU, name: "介護助手", defaultStartMin: t(9), defaultEndMin: t(13), sortOrder: 9 },
  { id: SLOT_KANGO, name: "看護", defaultStartMin: t(9), defaultEndMin: t(18), sortOrder: 10 },
  { id: SLOT_SPOT_PM, name: "スポット午後", defaultStartMin: t(13), defaultEndMin: t(17), sortOrder: 11 },
];

// ---------------------------------------------------------------------------
// 業務の型
// ---------------------------------------------------------------------------

const CAT_CORE = "core";
const CAT_NONCORE = "noncore";
const LEADER = "きょうのリーダー PHS 201";
const CONTACT_CARE = `同じ枠の常勤 ／ ${LEADER}`;
const CONTACT_NURSE = `看護師 PHS 210 ／ ${LEADER}`;

const TPL_WAKEUP = "tpl-wakeup";
const TPL_BREAKFAST = "tpl-breakfast";
const TPL_ORAL = "tpl-oral-care";
const TPL_DIAPER = "tpl-diaper";
const TPL_TOILET = "tpl-toilet";
const TPL_HYDRATION = "tpl-hydration";
const TPL_BATH_GROUP = "tpl-bath-group";
const TPL_BATH_INDIV = "tpl-bath-individual";
const TPL_WATCH = "tpl-watch";
const TPL_LUNCH = "tpl-lunch";
const TPL_SNACK = "tpl-snack";
const TPL_DINNER = "tpl-dinner";
const TPL_BEDTIME = "tpl-bedtime";
const TPL_ROUNDS = "tpl-rounds";
const TPL_REPOSITION = "tpl-reposition";
const TPL_VITALS = "tpl-vitals";
const TPL_ESCORT = "tpl-escort";
const TPL_VISIT = "tpl-visit";
const TPL_LINEN = "tpl-linen";
const TPL_RESTOCK = "tpl-restock";
const TPL_DINING_PREP = "tpl-dining-prep";
const TPL_LAUNDRY = "tpl-laundry";
const TPL_ROOM_CLEAN = "tpl-room-clean";
const TPL_SNACK_PREP = "tpl-snack-prep";
const TPL_RECORDS = "tpl-records";
const TPL_REC_PREP = "tpl-rec-prep";
const TPL_HANDOVER = "tpl-handover";
const TPL_ARRIVAL = "tpl-arrival";
const TPL_BREAK_1 = "tpl-break-1";
const TPL_BREAK_2 = "tpl-break-2";
const TPL_BREAK_3 = "tpl-break-3";
const TPL_BREAK_NIGHT = "tpl-break-night";

const templates: TaskTemplate[] = [
  {
    id: TPL_WAKEUP,
    name: "起床介助",
    kind: "care",
    categoryId: CAT_CORE,
    targetMode: "group",
    defaultDurationMin: 60,
    defaultHeadcount: 2,
    requiredTags: [],
    place: "各居室",
    scopeNote: "声かけ、着替えと整容の手伝い、食堂までの移動の見守り。",
    outOfScopeNote: "移乗に不安がある方は一人で行わず、同じ枠の常勤と二人で行います。",
    procedure: [
      "部屋の順番表（詰所の壁）に沿って回る",
      "カーテンを開け、名前を呼んで声をかけてから始める",
      "着替えはご本人のペースで。できるところはご自身で",
      "食堂へ移動したら、席に着いたことを確認する",
    ],
    supplies: "更衣用品は各居室のクローゼット右側。タオルはリネン室",
    contact: CONTACT_CARE,
  },
  {
    id: TPL_BREAKFAST,
    name: "朝食介助",
    kind: "care",
    categoryId: CAT_CORE,
    targetMode: "group",
    defaultDurationMin: 60,
    defaultHeadcount: 2,
    requiredTags: [],
    place: "食堂",
    scopeNote: "配膳、エプロンの準備、食事中の見守りと声かけ、下膳。",
    outOfScopeNote: "一口ごとの介助が必要な方は、担当表で決まった職員が行います。むせがあれば手を止めて常勤へ。",
    procedure: [
      "配膳車の名札と席札を照合してから配る",
      "食事中は食堂全体が見える位置に立つ",
      "食べ終えた方から下膳し、食事量は常勤に口頭で伝える",
    ],
    supplies: "エプロン・おしぼりは食堂入口のワゴン",
    contact: CONTACT_CARE,
  },
  {
    id: TPL_ORAL,
    name: "口腔ケア",
    kind: "care",
    categoryId: CAT_CORE,
    targetMode: "group",
    defaultDurationMin: 30,
    defaultHeadcount: 2,
    requiredTags: [],
    place: "食堂",
    scopeNote: "口腔ケア用品を配り、ご自身でできる方への声かけと見守り。終わった用品の回収と洗浄。",
    outOfScopeNote: "義歯の着脱と口腔内の清拭は常勤が行います。迷ったら手を止めて声をかけてください。",
    procedure: [
      "食事が終わった方から、席のまま行う",
      "名前つきのコップと歯ブラシを配る",
      "ご自身でできる方は見守り。むせがあればすぐ常勤へ",
      "終わった用品はかごに戻し、洗浄して乾燥棚へ",
      "最後に食堂の床を確認（水こぼれ）",
    ],
    supplies: "口腔ケア用品は食堂奥の棚、2段目のかご。コップは各自の名前つき",
    contact: CONTACT_CARE,
  },
  {
    id: TPL_DIAPER,
    name: "おむつ交換",
    kind: "care",
    categoryId: CAT_CORE,
    targetMode: "group",
    defaultDurationMin: 30,
    defaultHeadcount: 4,
    requiredTags: [],
    place: "各居室",
    scopeNote: "決まった順路で居室を回り、交換と衣類・シーツの確認。使用済みの処理。",
    outOfScopeNote: "皮膚の状態に気になることがあれば、自分で判断せず看護師か常勤に伝えます。",
    procedure: [
      "ワゴンに物品をそろえてから出発する（順路表はワゴンの上）",
      "入室前にノックと声かけ。カーテンを閉める",
      "交換のたびに手指消毒。使用済みは密閉して回収袋へ",
      "終わったらワゴンの補充メモに不足を書く",
    ],
    supplies: "おむつ・パッドはリネン室の棚（部屋番号ごとのかご）。手袋はワゴン",
    contact: CONTACT_CARE,
  },
  {
    id: TPL_TOILET,
    name: "排泄介助",
    kind: "care",
    categoryId: CAT_CORE,
    targetMode: "individual",
    defaultDurationMin: 30,
    defaultHeadcount: 1,
    requiredTags: [],
    place: "居室・トイレ",
    scopeNote: "トイレまでの移動の見守りと、衣類の上げ下ろしの手伝い。",
    outOfScopeNote: "立ち上がりが不安定な方は一人で介助しません。常勤を呼んで二人で行います。",
    procedure: [
      "声をかけてから、ご本人のペースで移動する",
      "手すりを持ってもらい、そばで見守る",
      "終わったら手洗いまで付き添う",
    ],
    supplies: "予備の衣類は各居室クローゼット。清拭用品はトイレ内の棚",
    contact: CONTACT_CARE,
  },
  {
    id: TPL_HYDRATION,
    name: "水分補給",
    kind: "care",
    categoryId: CAT_CORE,
    targetMode: "group",
    defaultDurationMin: 30,
    defaultHeadcount: 1,
    requiredTags: [],
    place: "食堂・ホール",
    scopeNote: "飲み物を配り、飲めたかどうかを見守る。",
    outOfScopeNote: "とろみの濃さは常勤が決めたとおりにします。自分で変えません。",
    procedure: [
      "名札つきのコップで配る（とろみの有無は名札に印）",
      "飲みにくそうな方は無理にすすめず、常勤に伝える",
      "飲めた量をホワイトボードに記入する",
    ],
    supplies: "飲み物・とろみ剤は食堂のカウンター",
    contact: CONTACT_CARE,
  },
  {
    id: TPL_BATH_GROUP,
    name: "入浴介助",
    kind: "care",
    categoryId: CAT_CORE,
    targetMode: "group",
    defaultDurationMin: 90,
    defaultHeadcount: 3,
    requiredTags: ["入浴担当可"],
    place: "浴室（1階）",
    scopeNote: "脱衣・洗身・洗髪の手伝い、浴室内の見守り、着替え。入浴の順番は入浴表のとおり。",
    outOfScopeNote: "入浴可否の判断は看護師が朝に決めています。体調に変化があれば中止して相談します。",
    procedure: [
      "入浴表（脱衣室の壁）の順に居室へ迎えに行く",
      "脱衣室は常に一人が残り、浴室内は目を離さない",
      "湯温は湯温計で確認してから案内する",
      "終わったら水分をすすめ、居室まで送る",
    ],
    supplies: "タオル・着替えは脱衣室の棚。滑り止めマットは浴室入口",
    contact: CONTACT_CARE,
  },
  {
    id: TPL_BATH_INDIV,
    name: "入浴介助（2人介助）",
    kind: "care",
    categoryId: CAT_CORE,
    targetMode: "individual",
    defaultDurationMin: 60,
    defaultHeadcount: 2,
    requiredTags: ["入浴担当可"],
    place: "ユニット浴室",
    scopeNote: "常勤と二人で行う入浴の補助。物品の準備、着替え、浴室の片付け。",
    outOfScopeNote: "移乗はこの枠の常勤が主になります。指示があるまで持ち上げません。",
    procedure: [
      "二人そろってから始める。一人では始めない",
      "リフトを使う場合は常勤の操作に合わせる",
      "終わったら浴室の床を流し、換気をする",
    ],
    supplies: "ユニット浴室の棚。リフトのシートは脱衣室のフック",
    contact: CONTACT_CARE,
  },
  {
    id: TPL_WATCH,
    name: "見守り",
    kind: "care",
    categoryId: CAT_CORE,
    targetMode: "group",
    defaultDurationMin: 120,
    defaultHeadcount: 1,
    requiredTags: [],
    place: "フロア・ホール",
    scopeNote: "フロアに居て、ナースコールと皆さんの様子に気を配る。立ち上がりの多い方のそばにいる。",
    outOfScopeNote: "この枠の間はフロアを離れません。離れる用事ができたら、代わりの人を呼んでから。",
    procedure: [
      "ホール全体が見える席に座る（入口側）",
      "コールが鳴ったら、場所を確認してから向かう",
      "次の見守り担当が来るまでフロアを離れない",
    ],
    supplies: "PHS は詰所の充電台",
    contact: CONTACT_CARE,
  },
  {
    id: TPL_LUNCH,
    name: "昼食介助",
    kind: "care",
    categoryId: CAT_CORE,
    targetMode: "group",
    defaultDurationMin: 60,
    defaultHeadcount: 2,
    requiredTags: [],
    place: "食堂",
    scopeNote: "配膳、食事中の見守りと声かけ、下膳。",
    outOfScopeNote: "一口ごとの介助が必要な方は、担当表で決まった職員が行います。",
    procedure: [
      "配膳車の名札と席札を照合してから配る",
      "食事中は食堂全体が見える位置に立つ",
      "食べ終えた方から下膳し、食事量は常勤に口頭で伝える",
    ],
    supplies: "エプロン・おしぼりは食堂入口のワゴン",
    contact: CONTACT_CARE,
  },
  {
    id: TPL_SNACK,
    name: "おやつ介助",
    kind: "care",
    categoryId: CAT_CORE,
    targetMode: "group",
    defaultDurationMin: 30,
    defaultHeadcount: 2,
    requiredTags: [],
    place: "食堂",
    scopeNote: "おやつと飲み物を配り、見守る。",
    outOfScopeNote: "食事形態（きざみ・とろみ）は名札のとおり。自分で変えません。",
    procedure: ["名札つきのトレーで配る", "飲み物を先に出す", "食べ終えた方から下膳"],
    supplies: "おやつはパントリーの冷蔵庫、飲み物は食堂カウンター",
    contact: CONTACT_CARE,
  },
  {
    id: TPL_DINNER,
    name: "夕食介助",
    kind: "care",
    categoryId: CAT_CORE,
    targetMode: "group",
    defaultDurationMin: 60,
    defaultHeadcount: 1,
    requiredTags: [],
    place: "食堂",
    scopeNote: "配膳、食事中の見守りと声かけ、下膳。",
    outOfScopeNote: "一口ごとの介助が必要な方は、担当表で決まった職員が行います。",
    procedure: ["配膳車の名札と席札を照合してから配る", "食事中は食堂全体が見える位置に立つ", "下膳後にテーブルを拭く"],
    supplies: "エプロン・おしぼりは食堂入口のワゴン",
    contact: CONTACT_CARE,
  },
  {
    id: TPL_BEDTIME,
    name: "就寝介助",
    kind: "care",
    categoryId: CAT_CORE,
    targetMode: "group",
    defaultDurationMin: 60,
    defaultHeadcount: 1,
    requiredTags: [],
    place: "各居室",
    scopeNote: "着替えと整容の手伝い、ベッドまでの移動の見守り、消灯。",
    outOfScopeNote: "眠前の薬は看護師の指示どおり。自分で判断して渡しません。",
    procedure: ["部屋の順番表に沿って回る", "ナースコールを手の届く所に置く", "最後に廊下の灯りを落とす"],
    supplies: "寝衣は各居室のクローゼット左側",
    contact: CONTACT_CARE,
  },
  {
    id: TPL_ROUNDS,
    name: "巡視",
    kind: "care",
    categoryId: CAT_CORE,
    targetMode: "group",
    defaultDurationMin: 30,
    defaultHeadcount: 1,
    requiredTags: [],
    place: "各居室",
    scopeNote: "全居室を回り、呼吸・体勢・ナースコールの位置を確かめる。",
    outOfScopeNote: "気になることがあれば、まず看護師のオンコールへ。",
    procedure: ["懐中電灯は足元を照らす", "布団のずれと転落防止柵を確認", "巡視表にチェックを入れる"],
    supplies: "懐中電灯・巡視表は詰所",
    contact: CONTACT_NURSE,
  },
  {
    id: TPL_REPOSITION,
    name: "体位変換",
    kind: "care",
    categoryId: CAT_CORE,
    targetMode: "group",
    defaultDurationMin: 30,
    defaultHeadcount: 1,
    requiredTags: [],
    place: "各居室",
    scopeNote: "対象の方の向きを、体位表のとおりに変える。",
    outOfScopeNote: "体位表にない方は行いません。皮膚の赤みに気づいたら看護師へ。",
    procedure: ["体位表（ベッド脇）の向きに合わせる", "クッションで支える", "終わった向きを表に記入"],
    supplies: "クッションは各居室の棚",
    contact: CONTACT_NURSE,
  },
  {
    id: TPL_VITALS,
    name: "バイタル測定",
    kind: "care",
    categoryId: CAT_CORE,
    targetMode: "individual",
    defaultDurationMin: 30,
    defaultHeadcount: 1,
    requiredTags: ["看護師"],
    place: "居室",
    scopeNote: "体温・血圧・脈の測定と記録。",
    outOfScopeNote: "測定値の判断は看護師が行います。",
    procedure: ["測定前に5分ほど安静にしてもらう", "記録表に時刻とともに記入"],
    supplies: "測定器は詰所の棚",
    contact: CONTACT_NURSE,
  },
  {
    id: TPL_ESCORT,
    name: "受診の付き添い",
    kind: "care",
    categoryId: CAT_CORE,
    targetMode: "individual",
    defaultDurationMin: 90,
    defaultHeadcount: 1,
    requiredTags: [],
    place: "外出（受診先）",
    scopeNote: "送迎車への乗降の手伝い、受診先での付き添い、持ち物の管理。",
    outOfScopeNote: "医師への説明は看護師が用意した紙のとおりに。追加の判断はしません。",
    procedure: ["受診セット（保険証・お薬手帳・紹介状）を詰所で受け取る", "出発と帰着をリーダーに連絡", "帰着後に受診結果の紙を看護師へ"],
    supplies: "受診セットは詰所の引き出し",
    contact: CONTACT_NURSE,
  },
  {
    id: TPL_VISIT,
    name: "面会対応",
    kind: "care",
    categoryId: CAT_NONCORE,
    targetMode: "individual",
    defaultDurationMin: 30,
    defaultHeadcount: 1,
    requiredTags: [],
    place: "面会室",
    scopeNote: "ご家族の受付、面会室への案内、終了後の居室までの付き添い。",
    outOfScopeNote: "体調や介護の内容についての質問は、常勤かリーダーにつなぎます。",
    procedure: ["受付簿に記入してもらう", "面会室へ案内し、お茶を出す", "終了後は居室まで付き添う"],
    supplies: "受付簿は玄関カウンター",
    contact: CONTACT_CARE,
  },
  {
    id: TPL_LINEN,
    name: "リネン回収",
    kind: "care",
    categoryId: CAT_NONCORE,
    targetMode: "none",
    defaultDurationMin: 30,
    defaultHeadcount: 1,
    requiredTags: [],
    place: "各居室・リネン室",
    scopeNote: "使用済みのシーツ・タオルを回収し、リネン室のカゴへ。",
    outOfScopeNote: "汚染の強いものは別袋。迷ったら常勤に確認。",
    procedure: ["回収カートで東→さくらの順に回る", "色分けの袋に分ける", "リネン室の回収表に数を記入"],
    supplies: "回収袋はリネン室入口",
    contact: CONTACT_CARE,
  },
  {
    id: TPL_RESTOCK,
    name: "物品補充",
    kind: "care",
    categoryId: CAT_NONCORE,
    targetMode: "none",
    defaultDurationMin: 30,
    defaultHeadcount: 1,
    requiredTags: [],
    place: "倉庫・各ワゴン",
    scopeNote: "おむつ・手袋・消毒液などをワゴンと居室に補充する。",
    outOfScopeNote: "発注はしません。在庫が少ないときは補充メモに書くだけ。",
    procedure: ["各ワゴンの補充メモを見る", "倉庫から持ち出した数を出庫表に書く", "補充後にメモを消す"],
    supplies: "倉庫は1階エレベーター横。鍵は詰所",
    contact: CONTACT_CARE,
  },
  {
    id: TPL_DINING_PREP,
    name: "食堂準備",
    kind: "care",
    categoryId: CAT_NONCORE,
    targetMode: "none",
    defaultDurationMin: 30,
    defaultHeadcount: 1,
    requiredTags: [],
    place: "食堂",
    scopeNote: "テーブル拭き、席札とエプロンの配置、お茶の用意。",
    outOfScopeNote: "席の配置は席札のとおり。変えません。",
    procedure: ["テーブルを拭いて席札を置く", "エプロンとおしぼりを配る", "お茶を人数分用意"],
    supplies: "席札・エプロンは食堂入口のワゴン",
    contact: CONTACT_CARE,
  },
  {
    id: TPL_LAUNDRY,
    name: "洗濯物たたみ",
    kind: "care",
    categoryId: CAT_NONCORE,
    targetMode: "none",
    defaultDurationMin: 60,
    defaultHeadcount: 1,
    requiredTags: [],
    place: "リネン室",
    scopeNote: "乾いた洗濯物をたたみ、名前ごとに分けて居室へ戻す。",
    outOfScopeNote: "名前の読めないものは常勤へ。",
    procedure: ["名前タグで分ける", "居室のクローゼットの決まった段に戻す"],
    supplies: "たたみ台はリネン室",
    contact: CONTACT_CARE,
  },
  {
    id: TPL_ROOM_CLEAN,
    name: "居室清掃",
    kind: "care",
    categoryId: CAT_NONCORE,
    targetMode: "none",
    defaultDurationMin: 60,
    defaultHeadcount: 1,
    requiredTags: [],
    place: "各居室",
    scopeNote: "床掃除、ごみ回収、洗面台の拭き上げ。",
    outOfScopeNote: "ご本人の私物は動かしません。",
    procedure: ["清掃カートで順に回る", "在室中は声をかけてから", "ごみは分別してごみ置き場へ"],
    supplies: "清掃カートは1階倉庫",
    contact: CONTACT_CARE,
  },
  {
    id: TPL_SNACK_PREP,
    name: "おやつ準備",
    kind: "care",
    categoryId: CAT_NONCORE,
    targetMode: "none",
    defaultDurationMin: 30,
    defaultHeadcount: 1,
    requiredTags: [],
    place: "パントリー",
    scopeNote: "おやつと飲み物を人数分トレーに載せる。",
    outOfScopeNote: "食事形態の変更はしません。名札のとおりに。",
    procedure: ["名札つきトレーを並べる", "きざみ・とろみは名札の印のとおり", "配る時刻までパントリーに置く"],
    supplies: "パントリーの冷蔵庫",
    contact: CONTACT_CARE,
  },
  {
    id: TPL_RECORDS,
    name: "記録入力",
    kind: "care",
    categoryId: CAT_NONCORE,
    targetMode: "none",
    defaultDurationMin: 60,
    defaultHeadcount: 1,
    requiredTags: [],
    place: "詰所",
    scopeNote: "介護記録ソフトへの入力。",
    outOfScopeNote: "ケアナビは記録を持ちません。記録は施設の記録ソフトへ。",
    procedure: ["詰所の端末で入力する", "入力後にホワイトボードのメモを消す"],
    supplies: "端末は詰所",
    contact: LEADER,
  },
  {
    id: TPL_REC_PREP,
    name: "レク準備",
    kind: "care",
    categoryId: CAT_NONCORE,
    targetMode: "none",
    defaultDurationMin: 30,
    defaultHeadcount: 1,
    requiredTags: [],
    place: "ホール",
    scopeNote: "椅子の配置、道具の用意、音響の確認。",
    outOfScopeNote: "内容の変更はレク担当に相談。",
    procedure: ["レク表（ホールの壁）を見る", "椅子を半円に並べる", "道具は終わったら元の箱へ"],
    supplies: "レク用品はホールの収納",
    contact: CONTACT_CARE,
  },
  {
    id: TPL_HANDOVER,
    name: "申し送り",
    kind: "care",
    categoryId: CAT_NONCORE,
    targetMode: "none",
    defaultDurationMin: 30,
    defaultHeadcount: 2,
    requiredTags: [],
    place: "詰所",
    scopeNote: "前の勤務帯からの伝達を聞き、今日の担当を確認する。",
    outOfScopeNote: "聞き取れなかったことは、その場で聞き返します。",
    procedure: ["申し送りノートを開く", "自分の今日の担当をケアナビで確認する"],
    supplies: "申し送りノートは詰所",
    contact: LEADER,
  },
  {
    id: TPL_ARRIVAL,
    name: "到着・案内",
    kind: "care",
    categoryId: CAT_NONCORE,
    targetMode: "none",
    defaultDurationMin: 15,
    defaultHeadcount: 2,
    requiredTags: [],
    place: "玄関・詰所",
    scopeNote: "一緒の担当（リーダー）と会い、更衣室・トイレ・詰所・非常口を一緒に回る。きょうの予定をスマホで確認する。",
    outOfScopeNote: "この時間は利用者の介助に入りません。案内が終わってから、次の予定へ。",
    procedure: [
      "玄関で受付簿に記入し、リーダーを呼ぶ",
      "更衣室で着替え、PHS を受け取る",
      "詰所・トイレ・非常口の場所を一緒に確認する",
      "次の予定（口腔ケア）の場所まで一緒に行く",
    ],
    supplies: "名札と PHS は詰所の充電台",
    contact: LEADER,
  },
  {
    id: TPL_BREAK_1,
    name: "休憩①",
    kind: "break",
    targetMode: "none",
    defaultDurationMin: 60,
    defaultHeadcount: 2,
    requiredTags: [],
    place: "休憩室",
    procedure: [],
  },
  {
    id: TPL_BREAK_2,
    name: "休憩②",
    kind: "break",
    targetMode: "none",
    defaultDurationMin: 60,
    defaultHeadcount: 3,
    requiredTags: [],
    place: "休憩室",
    procedure: [],
  },
  {
    id: TPL_BREAK_3,
    name: "休憩③",
    kind: "break",
    targetMode: "none",
    defaultDurationMin: 60,
    defaultHeadcount: 2,
    requiredTags: [],
    place: "休憩室",
    procedure: [],
  },
  {
    id: TPL_BREAK_NIGHT,
    name: "休憩（夜勤）",
    kind: "break",
    targetMode: "none",
    defaultDurationMin: 60,
    defaultHeadcount: 1,
    requiredTags: [],
    place: "休憩室",
    procedure: [],
  },
];

// ---------------------------------------------------------------------------
// 一日の型
// ---------------------------------------------------------------------------

interface ItemSpec {
  id: string;
  tpl: ID;
  start: number;
  end: number;
  group?: ID;
  slots: ID[];
  hc: number;
  residents?: ID[];
}

/** targetRule は型の targetMode から決める（residents 指定があれば residents） */
const item = (spec: ItemSpec): DayPatternItem => {
  const tpl = templates.find((x) => x.id === spec.tpl);
  const mode = tpl ? tpl.targetMode : "none";
  const targetRule = spec.residents ? "residents" : mode === "group" ? "allInGroup" : "none";
  return {
    id: spec.id,
    templateId: spec.tpl,
    startMin: spec.start,
    endMin: spec.end,
    ...(spec.group ? { groupId: spec.group } : {}),
    targetRule,
    ...(spec.residents ? { residentIds: spec.residents } : {}),
    headcount: spec.hc,
    slotIds: spec.slots,
  };
};

/**
 * 日勤帯の枠（入浴日・平日・日曜で共有。入浴日だけ一部の束ね先が変わる）。
 *
 * 束ね方の決まり（この施設の設定）:
 * - 同じ番に、時間の重なる枠を束ねない（休憩も含む）。
 * - 早番A（リーダー）は入浴に入らない。午前は東フロアの見守り（ホール全体が見える）と食堂準備。
 * - 9:00–17:00、東フロアは見守りの担当が切れ目なくいる。さくらユニットは見守りか、日勤さくらの食堂での業務で切れ目なくいる。
 * - おむつ交換（東・午前）は、その時間に東フロアにいて見守りでない番の全員。
 */
const dayCommon = (bathDay: boolean): ItemSpec[] => [
  { id: "handover-am", tpl: TPL_HANDOVER, start: t(7), end: t(7, 30), group: GRP_COMMON, slots: [SLOT_HAYABAN_A, SLOT_HAYABAN_B], hc: 2 },
  { id: "wakeup-east", tpl: TPL_WAKEUP, start: t(7, 30), end: t(8), group: GRP_EAST, slots: [SLOT_HAYABAN_A, SLOT_HAYABAN_B], hc: 2 },
  { id: "breakfast-east", tpl: TPL_BREAKFAST, start: t(8), end: t(9), group: GRP_EAST, slots: [SLOT_HAYABAN_A, SLOT_HAYABAN_B], hc: 2 },
  // 見守り（東）
  { id: "watch-east-1", tpl: TPL_WATCH, start: t(9), end: t(11), group: GRP_EAST, slots: [SLOT_HAYABAN_A], hc: 1 },
  { id: "watch-east-2", tpl: TPL_WATCH, start: t(11), end: t(13), group: GRP_EAST, slots: [SLOT_OSOBAN], hc: 1 },
  { id: "watch-east-3", tpl: TPL_WATCH, start: t(13), end: t(15), group: GRP_EAST, slots: [SLOT_NIKKIN_B], hc: 1 },
  { id: "watch-east-4", tpl: TPL_WATCH, start: t(15), end: t(17), group: GRP_EAST, slots: [SLOT_NIKKIN_A], hc: 1 },
  // 見守り（さくら）
  // 見守り（さくら）: 日勤さくらが持つ。食事・口腔ケア・おやつは日勤さくらが食堂で行うので見守りを置かない。
  // 東の番がさくらを見るのは、小林様の入浴中（入浴日 10–11）と日勤さくらの休憩中（14–15）だけ。
  ...(bathDay
    ? [
        { id: "watch-sakura-1", tpl: TPL_WATCH, start: t(9), end: t(10), group: GRP_SAKURA, slots: [SLOT_NIKKIN_SAKURA], hc: 1 },
        { id: "watch-sakura-1b", tpl: TPL_WATCH, start: t(10), end: t(11), group: GRP_SAKURA, slots: [SLOT_HAYABAN_B], hc: 1 },
      ]
    : [{ id: "watch-sakura-1", tpl: TPL_WATCH, start: t(9), end: t(11), group: GRP_SAKURA, slots: [SLOT_NIKKIN_SAKURA], hc: 1 }]),
  { id: "watch-sakura-2", tpl: TPL_WATCH, start: t(11), end: t(12), group: GRP_SAKURA, slots: [SLOT_NIKKIN_SAKURA], hc: 1 },
  { id: "watch-sakura-3", tpl: TPL_WATCH, start: t(13, 30), end: t(14), group: GRP_SAKURA, slots: [SLOT_NIKKIN_SAKURA], hc: 1 },
  { id: "watch-sakura-3b", tpl: TPL_WATCH, start: t(14), end: t(15), group: GRP_SAKURA, slots: [SLOT_HAYABAN_B], hc: 1 },
  { id: "watch-sakura-4", tpl: TPL_WATCH, start: t(15, 30), end: t(17), group: GRP_SAKURA, slots: [SLOT_NIKKIN_SAKURA], hc: 1 },
  // 午前
  { id: "vitals-tanaka", tpl: TPL_VITALS, start: t(9), end: t(9, 30), group: GRP_SAKURA, slots: [SLOT_KANGO], hc: 1, residents: [RES_TANAKA] },
  { id: "toilet-tanaka-am", tpl: TPL_TOILET, start: t(9, 30), end: t(10), group: GRP_SAKURA, slots: [SLOT_NIKKIN_B], hc: 1, residents: [RES_TANAKA] },
  { id: "linen", tpl: TPL_LINEN, start: t(9, 30), end: t(10), group: GRP_COMMON, slots: [SLOT_JOSHU], hc: 1 },
  bathDay
    ? { id: "diaper-east-am", tpl: TPL_DIAPER, start: t(10), end: t(10, 30), group: GRP_EAST, slots: [SLOT_NIKKIN_A, SLOT_NIKKIN_C], hc: 2 }
    : { id: "diaper-east-am", tpl: TPL_DIAPER, start: t(10), end: t(10, 30), group: GRP_EAST, slots: [SLOT_NIKKIN_A, SLOT_NIKKIN_B, SLOT_NIKKIN_C], hc: 3 },
  { id: "break-1", tpl: TPL_BREAK_1, start: t(11), end: t(12), group: GRP_COMMON, slots: [SLOT_HAYABAN_B, SLOT_NIKKIN_B], hc: 2 },
  { id: "dining-prep", tpl: TPL_DINING_PREP, start: t(11, 30), end: t(12), group: GRP_COMMON, slots: [SLOT_HAYABAN_A], hc: 1 },
  // 昼
  { id: "lunch-east", tpl: TPL_LUNCH, start: t(12), end: t(13), group: GRP_EAST, slots: [SLOT_HAYABAN_A, SLOT_HAYABAN_B, SLOT_NIKKIN_A, SLOT_NIKKIN_B], hc: 4 },
  { id: "lunch-sakura", tpl: TPL_LUNCH, start: t(12), end: t(13), group: GRP_SAKURA, slots: [SLOT_NIKKIN_SAKURA, SLOT_NIKKIN_C], hc: 2 },
  { id: "restock", tpl: TPL_RESTOCK, start: t(12), end: t(12, 30), group: GRP_COMMON, slots: [SLOT_JOSHU], hc: 1 },
  // 午後
  { id: "spot-arrival", tpl: TPL_ARRIVAL, start: t(13), end: t(13, 15), group: GRP_COMMON, slots: [SLOT_SPOT_PM, SLOT_HAYABAN_A], hc: 2 },
  { id: "oral-east-pm", tpl: TPL_ORAL, start: t(13, 15), end: t(14), group: GRP_EAST, slots: [SLOT_SPOT_PM, SLOT_HAYABAN_A], hc: 2 },
  { id: "oral-sakura-pm", tpl: TPL_ORAL, start: t(13), end: t(13, 30), group: GRP_SAKURA, slots: [SLOT_NIKKIN_SAKURA], hc: 1 },
  { id: "break-2", tpl: TPL_BREAK_2, start: t(13), end: t(14), group: GRP_COMMON, slots: [SLOT_NIKKIN_A, SLOT_NIKKIN_C, SLOT_OSOBAN], hc: 3 },
  { id: "break-3", tpl: TPL_BREAK_3, start: t(14), end: t(15), group: GRP_COMMON, slots: [SLOT_HAYABAN_A, SLOT_NIKKIN_SAKURA], hc: 2 },
  { id: "snack-prep", tpl: TPL_SNACK_PREP, start: t(14, 30), end: t(15), group: GRP_COMMON, slots: [SLOT_NIKKIN_A], hc: 1 },
  { id: "snack-east", tpl: TPL_SNACK, start: t(15), end: t(15, 30), group: GRP_EAST, slots: [SLOT_HAYABAN_A, SLOT_HAYABAN_B, SLOT_SPOT_PM], hc: 3 },
  { id: "snack-sakura", tpl: TPL_SNACK, start: t(15), end: t(15, 30), group: GRP_SAKURA, slots: [SLOT_NIKKIN_SAKURA], hc: 1 },
  { id: "hydration-east", tpl: TPL_HYDRATION, start: t(15, 30), end: t(16), group: GRP_EAST, slots: [SLOT_SPOT_PM, SLOT_HAYABAN_B], hc: 2 },
  { id: "diaper-east-pm", tpl: TPL_DIAPER, start: t(16), end: t(16, 30), group: GRP_EAST, slots: [SLOT_OSOBAN, SLOT_SPOT_PM], hc: 2 },
  { id: "restock-pm", tpl: TPL_RESTOCK, start: t(16, 30), end: t(17), group: GRP_COMMON, slots: [SLOT_OSOBAN, SLOT_SPOT_PM], hc: 2 },
  { id: "toilet-tanaka-pm", tpl: TPL_TOILET, start: t(16), end: t(16, 30), group: GRP_SAKURA, slots: [SLOT_NIKKIN_B], hc: 1, residents: [RES_TANAKA] },
  { id: "records", tpl: TPL_RECORDS, start: t(17), end: t(18), group: GRP_COMMON, slots: [SLOT_NIKKIN_A, SLOT_NIKKIN_B, SLOT_NIKKIN_C], hc: 3 },
];

/** 夕方〜夜勤帯（全パターン共通） */
const nightCommon: ItemSpec[] = [
  { id: "dinner-east", tpl: TPL_DINNER, start: t(18), end: t(19), group: GRP_EAST, slots: [SLOT_OSOBAN, SLOT_YAKIN_EAST], hc: 2 },
  { id: "dinner-sakura", tpl: TPL_DINNER, start: t(18), end: t(19), group: GRP_SAKURA, slots: [SLOT_YAKIN_SAKURA], hc: 1 },
  { id: "bedtime-east", tpl: TPL_BEDTIME, start: t(20), end: t(21), group: GRP_EAST, slots: [SLOT_YAKIN_EAST], hc: 1 },
  { id: "bedtime-sakura", tpl: TPL_BEDTIME, start: t(20), end: t(21), group: GRP_SAKURA, slots: [SLOT_YAKIN_SAKURA], hc: 1 },
  { id: "rounds-east-22", tpl: TPL_ROUNDS, start: t(22), end: t(22, 30), group: GRP_EAST, slots: [SLOT_YAKIN_EAST], hc: 1 },
  { id: "rounds-sakura-22", tpl: TPL_ROUNDS, start: t(22), end: t(22, 30), group: GRP_SAKURA, slots: [SLOT_YAKIN_SAKURA], hc: 1 },
  { id: "rounds-east-00", tpl: TPL_ROUNDS, start: nx(0), end: nx(0, 30), group: GRP_EAST, slots: [SLOT_YAKIN_EAST], hc: 1 },
  { id: "rounds-sakura-00", tpl: TPL_ROUNDS, start: nx(0), end: nx(0, 30), group: GRP_SAKURA, slots: [SLOT_YAKIN_SAKURA], hc: 1 },
  { id: "reposition-east-01", tpl: TPL_REPOSITION, start: nx(1), end: nx(1, 30), group: GRP_EAST, slots: [SLOT_YAKIN_EAST], hc: 1, residents: REPOSITION_EAST },
  { id: "reposition-sakura-01", tpl: TPL_REPOSITION, start: nx(1), end: nx(1, 30), group: GRP_SAKURA, slots: [SLOT_YAKIN_SAKURA], hc: 1, residents: REPOSITION_SAKURA },
  // 夜勤の休憩は交互。休憩中のユニットの巡視は、もう一人の夜勤者が行う。
  { id: "break-night-east", tpl: TPL_BREAK_NIGHT, start: nx(1, 30), end: nx(2, 30), group: GRP_COMMON, slots: [SLOT_YAKIN_EAST], hc: 1 },
  { id: "rounds-sakura-0130", tpl: TPL_ROUNDS, start: nx(1, 30), end: nx(2), group: GRP_SAKURA, slots: [SLOT_YAKIN_SAKURA], hc: 1 },
  { id: "rounds-east-02", tpl: TPL_ROUNDS, start: nx(2), end: nx(2, 30), group: GRP_EAST, slots: [SLOT_YAKIN_SAKURA], hc: 1 },
  { id: "reposition-sakura-0230", tpl: TPL_REPOSITION, start: nx(2, 30), end: nx(3), group: GRP_SAKURA, slots: [SLOT_YAKIN_SAKURA], hc: 1, residents: REPOSITION_SAKURA },
  { id: "break-night-sakura", tpl: TPL_BREAK_NIGHT, start: nx(3), end: nx(4), group: GRP_COMMON, slots: [SLOT_YAKIN_SAKURA], hc: 1 },
  { id: "reposition-east-03", tpl: TPL_REPOSITION, start: nx(3), end: nx(3, 30), group: GRP_EAST, slots: [SLOT_YAKIN_EAST], hc: 1, residents: REPOSITION_EAST },
  { id: "rounds-sakura-0330", tpl: TPL_ROUNDS, start: nx(3, 30), end: nx(4), group: GRP_SAKURA, slots: [SLOT_YAKIN_EAST], hc: 1 },
  { id: "rounds-east-04", tpl: TPL_ROUNDS, start: nx(4), end: nx(4, 30), group: GRP_EAST, slots: [SLOT_YAKIN_EAST], hc: 1 },
  { id: "rounds-sakura-04", tpl: TPL_ROUNDS, start: nx(4), end: nx(4, 30), group: GRP_SAKURA, slots: [SLOT_YAKIN_SAKURA], hc: 1 },
  { id: "diaper-east-night", tpl: TPL_DIAPER, start: nx(5), end: nx(6), group: GRP_EAST, slots: [SLOT_YAKIN_EAST], hc: 1 },
  { id: "diaper-sakura-night", tpl: TPL_DIAPER, start: nx(5), end: nx(6), group: GRP_SAKURA, slots: [SLOT_YAKIN_SAKURA], hc: 1 },
  { id: "wakeup-east-night", tpl: TPL_WAKEUP, start: nx(6), end: nx(7), group: GRP_EAST, slots: [SLOT_YAKIN_EAST], hc: 1 },
  { id: "wakeup-sakura-night", tpl: TPL_WAKEUP, start: nx(6), end: nx(7), group: GRP_SAKURA, slots: [SLOT_YAKIN_SAKURA], hc: 1 },
  { id: "breakfast-sakura-night", tpl: TPL_BREAKFAST, start: nx(7, 30), end: nx(8, 30), group: GRP_SAKURA, slots: [SLOT_YAKIN_SAKURA], hc: 1 },
  { id: "handover-night", tpl: TPL_HANDOVER, start: nx(8, 30), end: nx(9), group: GRP_COMMON, slots: [SLOT_YAKIN_EAST, SLOT_YAKIN_SAKURA], hc: 2 },
];

/** 入浴日だけの枠（早番A＝リーダーは入れない） */
const bathOnly: ItemSpec[] = [
  { id: "bath-kobayashi", tpl: TPL_BATH_INDIV, start: t(10), end: t(11), group: GRP_SAKURA, slots: [SLOT_NIKKIN_SAKURA, SLOT_NIKKIN_B], hc: 2, residents: [RES_KOBAYASHI] },
  { id: "bath-east", tpl: TPL_BATH_GROUP, start: t(10, 30), end: t(12), group: GRP_EAST, slots: [SLOT_NIKKIN_C, SLOT_NIKKIN_A, SLOT_JOSHU], hc: 3, residents: BATH_EAST_RESIDENTS },
];

/** 平日・入浴日の午後の雑務 */
const weekdayChores: ItemSpec[] = [
  { id: "rec-prep-short", tpl: TPL_REC_PREP, start: t(14), end: t(14, 30), group: GRP_COMMON, slots: [SLOT_NIKKIN_A], hc: 1 },
  { id: "laundry", tpl: TPL_LAUNDRY, start: t(14), end: t(15), group: GRP_COMMON, slots: [SLOT_NIKKIN_C, SLOT_SPOT_PM], hc: 2 },
  { id: "room-clean-east", tpl: TPL_ROOM_CLEAN, start: t(15), end: t(16), group: GRP_EAST, slots: [SLOT_OSOBAN], hc: 1 },
];

/** 日曜はレクを長めに、雑務を軽く */
const sundayExtras: ItemSpec[] = [
  { id: "rec-prep-long", tpl: TPL_REC_PREP, start: t(14), end: t(15), group: GRP_COMMON, slots: [SLOT_NIKKIN_C, SLOT_OSOBAN], hc: 2 },
];

const build = (prefix: string, specs: ItemSpec[]): DayPatternItem[] =>
  specs.map((spec) => item({ ...spec, id: `${prefix}-${spec.id}` }));

const PAT_BATH_DAY = "pat-bath-day";
const PAT_WEEKDAY = "pat-weekday";
const PAT_SUNDAY = "pat-sunday";

const patterns: DayPattern[] = [
  {
    id: PAT_BATH_DAY,
    name: "入浴日（火・金）",
    weekdays: [2, 5],
    items: build("pbd", [...dayCommon(true), ...bathOnly, ...weekdayChores, ...nightCommon]),
  },
  {
    id: PAT_WEEKDAY,
    name: "平日",
    weekdays: [1, 3, 4, 6],
    items: build("pwd", [...dayCommon(false), ...weekdayChores, ...nightCommon]),
  },
  {
    id: PAT_SUNDAY,
    name: "日曜",
    weekdays: [0],
    items: build("psu", [...dayCommon(false), ...sundayExtras, ...nightCommon]),
  },
];

// ---------------------------------------------------------------------------
// 出勤者
// ---------------------------------------------------------------------------

const slotById = (id: ID): RoleSlot => {
  const found = roleSlots.find((x) => x.id === id);
  if (!found) throw new Error(`役割枠が見つかりません: ${id}`);
  return found;
};

const ros = (
  date: string,
  staffId: ID,
  slotId: ID,
  opts: { firstTimer?: boolean; absent?: boolean } = {},
): RosterEntry => {
  const slot = slotById(slotId);
  return {
    id: `ros-${date.replace(/-/g, "")}-${staffId.replace("stf-", "")}`,
    date,
    staffId,
    slotId,
    startMin: slot.defaultStartMin,
    endMin: slot.defaultEndMin,
    firstTimer: opts.firstTimer === true,
    absent: opts.absent === true,
  };
};

/** 先週の同じ曜日（番の引き継ぎ用。時間割は作らない） */
const D0 = "2026-10-27";
const D1 = "2026-11-03";
const D2 = "2026-11-04";

const roster: RosterEntry[] = [
  // 10/27（火）先週の入浴日。番だけ持つ（時間割は作らない）。介護助手は出勤、スポットなし。
  ros(D0, STF_SATO, SLOT_HAYABAN_A),
  ros(D0, STF_TAKAHASHI, SLOT_HAYABAN_B),
  ros(D0, STF_SUZUKI, SLOT_NIKKIN_A),
  ros(D0, STF_ITO, SLOT_NIKKIN_B),
  ros(D0, STF_YAMAMOTO, SLOT_NIKKIN_C),
  ros(D0, STF_OGAWA, SLOT_NIKKIN_SAKURA),
  ros(D0, STF_NAKAMURA, SLOT_KANGO),
  ros(D0, STF_KIMURA, SLOT_OSOBAN),
  ros(D0, STF_SAITO, SLOT_YAKIN_EAST),
  ros(D0, STF_NOGUCHI, SLOT_YAKIN_SAKURA),
  ros(D0, STF_WATANABE, SLOT_JOSHU),
  // 11/3（火）入浴日。介護助手は休み、スポットが午後に初回。
  ros(D1, STF_SATO, SLOT_HAYABAN_A),
  ros(D1, STF_TAKAHASHI, SLOT_HAYABAN_B),
  ros(D1, STF_SUZUKI, SLOT_NIKKIN_A),
  ros(D1, STF_ITO, SLOT_NIKKIN_B),
  ros(D1, STF_YAMAMOTO, SLOT_NIKKIN_C),
  ros(D1, STF_OGAWA, SLOT_NIKKIN_SAKURA),
  ros(D1, STF_NAKAMURA, SLOT_KANGO),
  ros(D1, STF_KIMURA, SLOT_OSOBAN),
  ros(D1, STF_KATO, SLOT_SPOT_PM, { firstTimer: true }),
  ros(D1, STF_SAITO, SLOT_YAKIN_EAST),
  ros(D1, STF_NOGUCHI, SLOT_YAKIN_SAKURA),
  ros(D1, STF_WATANABE, SLOT_JOSHU, { absent: true }),
  // 11/4（水）平日。介護助手が出勤、スポットなし。
  ros(D2, STF_SATO, SLOT_HAYABAN_A),
  ros(D2, STF_TAKAHASHI, SLOT_HAYABAN_B),
  ros(D2, STF_SUZUKI, SLOT_NIKKIN_A),
  ros(D2, STF_ITO, SLOT_NIKKIN_B),
  ros(D2, STF_YAMAMOTO, SLOT_NIKKIN_C),
  ros(D2, STF_OGAWA, SLOT_NIKKIN_SAKURA),
  ros(D2, STF_NAKAMURA, SLOT_KANGO),
  ros(D2, STF_KIMURA, SLOT_OSOBAN),
  ros(D2, STF_SAITO, SLOT_YAKIN_EAST),
  ros(D2, STF_NOGUCHI, SLOT_YAKIN_SAKURA),
  ros(D2, STF_WATANABE, SLOT_JOSHU),
];

// ---------------------------------------------------------------------------
// 型に含まれない当日限りの予定
// ---------------------------------------------------------------------------

const TASK_VISIT_MATSUMOTO = "task-20261103-visit-matsumoto";

const extraTasks: TaskInstance[] = [
  {
    id: TASK_VISIT_MATSUMOTO,
    date: D1,
    templateId: TPL_VISIT,
    name: "面会対応",
    kind: "care",
    categoryId: CAT_NONCORE,
    targetMode: "individual",
    groupId: GRP_EAST,
    startMin: t(15, 30),
    endMin: t(16),
    place: "面会室",
    headcount: 1,
    requiredTags: [],
    slotIds: [SLOT_NIKKIN_C],
    scopeNote: "ご家族の受付、面会室への案内、終了後の居室までの付き添い。",
    outOfScopeNote: "体調や介護の内容についての質問は、常勤かリーダーにつなぎます。",
    procedure: ["受付簿に記入してもらう", "面会室へ案内し、お茶を出す", "終了後は居室まで付き添う"],
    supplies: "受付簿は玄関カウンター",
    contact: CONTACT_CARE,
    note: "ご長男が 15:30 に来苑予定",
    status: "planned",
  },
];

const extraTargets: TaskTarget[] = [{ taskId: TASK_VISIT_MATSUMOTO, residentId: RES_MATSUMOTO }];

// ---------------------------------------------------------------------------
// まとめ
// ---------------------------------------------------------------------------

export const himawariSeed: SeedData = {
  facility: {
    id: "fac-himawari",
    name: "ひまわり苑",
    settings: {
      checkMode: "warn",
      residentDisplayMode: "roomAndSurname",
      firstTimerOnlyWarning: true,
      boardStartMin: t(6),
      boardEndMin: t(22),
      categories: [
        { id: CAT_CORE, name: "コア業務", kind: "core" },
        { id: CAT_NONCORE, name: "ノンコア業務", kind: "noncore" },
      ],
    },
  },
  groups,
  residents,
  staff,
  roleSlots,
  templates,
  patterns,
  roster,
  extraTasks,
  extraTargets,
  dayPatterns: [
    { date: D1, patternId: PAT_BATH_DAY },
    { date: D2, patternId: PAT_WEEKDAY },
  ],
};
