"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { TopBar } from "@/components/TopBar";
import { SETUP_NOTE_KEY, writeChosen } from "@/components/setup/setupNote";
import { useAppState, useDefaultDate, useEngine, useIncoming, useNowMinutes, useSyncStatus, isSampleFacility } from "@/store/react";
import { SyncEmpty } from "@/components/setup/Setup";
import { SyncBadge } from "@/components/SyncBadge";
import { SAMPLE_DATE } from "@/store/sample";
import { boardColumns, paletteRows, residentColumns, residentViewGroup } from "@/domain/layout";
import { headcountStatus, shortageGroups, tasksForDate, unfinishedTasks } from "@/domain/checks";
import { calendarDateOf, fmtMin, fmtRange } from "@/domain/time";
import { updatedAtLabel } from "@/domain/display";
import { addDays, addTodayPersonEvents, isFirstTimeDefault } from "@/domain/pattern";
import { SharedTaskCard, TaskCard } from "./TaskCard";
import { MorningBand } from "./MorningBand";
import { AbsenceFlow, EscortFlow, withShortageNote } from "@/components/me/AllView";
import { businessMinutes } from "@/domain/myday";
import type { Event } from "@/domain/events";
import type { State } from "@/domain/types";
import { TaskDetail } from "./TaskDetail";
import { AssignPanel } from "./AssignPanel";
import { BoardDnd, DropZone, useStaffDrag } from "./dnd";
import { StaffSheetPrint, StaffView } from "./StaffView";
import { BoardMenu } from "./BoardMenu";

/** 1分あたりの高さ(px)。1時間=180px。30分の業務でも2行（名前／担当・バッジ・＋44px）が入る */
const PX_PER_MIN = 3;
/** レール（見守りなど長い継続業務の帯）の幅 */
const RAIL_WIDTH = 28;
/** 短い業務も画面上はこの長さ（分）を占めるものとして並べる。20分 = 60px（1段のカードに ＋ が収まる） */
const MIN_VISUAL_MIN = 20;
/** 横に並ぶカード1枚あたりの最小幅(px) */
const MIN_CARD_WIDTH = 150;
/** 表示する範囲: 06:00 → 翌 06:00 */
const VIEW_START = 6 * 60;
const VIEW_END = 30 * 60;

function shortDateOf(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${m}/${d}`;
}

function weekdayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${m}月${d}日（${"日月火水木金土"[wd]}）`;
}

/** 見出しの「終わっていない n件」。押すと該当の枠へ順に移動する */
const UNFINISHED = "終わっていない";

export function Board({ date: dateParam }: { date?: string }) {
  const { state, ready, loaded } = useAppState();
  // ?date= がなければ今日（サンプル施設は基準日）。6:00 より前は前の日の業務日
  const defaultDate = useDefaultDate(state, "business");
  const date = dateParam ?? defaultDate ?? SAMPLE_DATE;
  const syncInfo = useSyncStatus();
  const incoming = useIncoming();
  // ほかの端末から届いたら一言（自分の操作のトーストと同じ場所。8秒で消える）
  const seenIncoming = useRef(0);
  useEffect(() => {
    if (incoming.count === 0 || incoming.count === seenIncoming.current) return;
    seenIncoming.current = incoming.count;
    if (syncInfo.kind !== "sync") return;
    const d = incoming.at ? new Date(incoming.at) : new Date();
    showNotice(`ほかの端末で変更がありました（更新 ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}）`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming.count]);
  const engine = useEngine();
  const lastUndo = useSyncExternalStore(
    (cb) => (engine ? engine.subscribe(cb) : () => {}),
    () => engine?.lastUndo ?? null,
    () => null,
  );
  // ツールバーの「元に戻す」は、見ている日に触れた操作（と日に依らない操作）だけ。ほかの日の操作を黙って戻さない（ループ 19）
  const viewUndo = useSyncExternalStore(
    (cb) => (engine ? engine.subscribe(cb) : () => {}),
    () => engine?.lastUndoWhere((u) => !u.dates || u.dates.includes(date)) ?? null,
    () => null,
  );
  const clockNow = useNowMinutes();
  // 前の日の業務日を 6:00 より前に見ているとき（夜勤帯）は、現在時刻を「翌」の分にする
  // まだ来ていない日は「いま」を持たない（現在時刻の線と「終わっていない n 件」を出さない。ループ 19）
  const future = defaultDate !== null && date > defaultDate;
  const now = future
    ? null
    : clockNow !== null && clockNow < 6 * 60 && date === addDays(calendarDateOf(new Date()), -1)
      ? clockNow + 24 * 60
      : clockNow;
  const [noteOpen, setNoteOpen] = useState(false);
  // ボードを開いて施設（サンプルを含む）を見たら、設定は「はじめに」ではなく追加・変更を出す（ループ 16）
  useEffect(() => {
    if (ready) writeChosen(true);
  }, [ready]);
  // 横軸［グループ｜職員｜利用者］と「見るグループ」（決定記録 0017）。その端末のブラウザで覚える（同期しない）
  const [view, setViewRaw] = useState<BoardAxis>("group");
  const [viewGroup, setViewGroupRaw] = useState<string>("");
  useEffect(() => {
    const saved = loadBoardView();
    if (saved) {
      setViewRaw(saved.axis);
      setViewGroupRaw(saved.group);
    }
  }, []);
  const setView = (axis: BoardAxis) => {
    setViewRaw(axis);
    saveBoardView({ axis, group: viewGroup });
  };
  const setViewGroup = (group: string) => {
    setViewGroupRaw(group);
    saveBoardView({ axis: view, group });
  };
  // 選んだグループが外されていたら「すべて」
  const groupId = viewGroup && state.groups[viewGroup] && state.groups[viewGroup].kind !== "common" ? viewGroup : undefined;
  // ［利用者］は 1 つのグループの方を並べる。「すべて」なら利用者のいる最初のグループ
  const residentGroup = view === "resident" ? residentViewGroup(state, groupId) : undefined;
  const filterGroup = view === "resident" ? residentGroup : groupId;
  const [printedAt, setPrintedAt] = useState("");
  // 印刷時刻は印刷の直前に入れる（ブラウザの印刷メニューから印刷したときも）
  useEffect(() => {
    const stamp = () => {
      const d = new Date();
      setPrintedAt(`${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`);
    };
    stamp();
    window.addEventListener("beforeprint", stamp);
    return () => window.removeEventListener("beforeprint", stamp);
  }, []);
  // 分担表は表示と関係なく印刷用に描いてあるので、画面の表示は切り替えない
  const printSheet = () => window.print();
  const forceBoard = false;
  const scroller = useRef<HTMLDivElement>(null);

  const columns = useMemo(
    () =>
      !ready
        ? []
        : view === "resident" && residentGroup
          ? residentColumns(state, date, residentGroup, (r) => `${r.room} ${r.surname}`, MIN_VISUAL_MIN)
          : boardColumns(state, date, MIN_VISUAL_MIN, groupId),
    [state, date, ready, view, residentGroup, groupId],
  );
  // 翌 6:00 より後に終わる業務（夜勤明けの朝食・申し送りなど）があれば、時間の軸をそこまで伸ばす（1時間単位）
  const gridEnd = useMemo(() => {
    const maxEnd = Math.max(VIEW_END, ...columns.flatMap((c) => c.cards.map((x) => x.task.endMin)));
    return Math.ceil(maxEnd / 60) * 60;
  }, [columns]);
  // 列の最小幅: 同じ時刻に横に並ぶ枚数に合わせて広げる（カードを細くしすぎない。足りなければ横にスクロール）
  const colTemplate = `64px ${columns
    .map((c) => {
      const min = Math.max(view === "resident" ? 190 : 220, Math.ceil((c.maxLanes * MIN_CARD_WIDTH) / (c.hasRail ? 1 - RAIL_WIDTH / 100 : 1)));
      // 余った幅も必要な幅の比で分ける
      return `minmax(${min}px, ${min}fr)`;
    })
    .join(" ")}`;
  const palette = useMemo(() => (ready ? paletteRows(state, date) : { working: [], off: [] }), [state, date, ready]);
  const groups = useMemo(() => (ready ? shortageGroups(state, date, filterGroup) : []), [state, date, ready, filterGroup]);
  // 絞っているとき、件数のうち共通の列の分（「東フロア 1・共通 2」と分けて書く。ループ 14 #13）
  const commonShort = useMemo(() => {
    const m = new Map<string, number>();
    if (!ready || !filterGroup) return m;
    for (const g of shortageGroups(state, date, filterGroup)) {
      const mine = shortageGroups(state, date, filterGroup).find((x) => x.label === g.label)?.count ?? 0;
      const onlyGroup = tasksForDate(state, date).filter((t) => t.groupId === filterGroup && headcountStatus(state, t.id).label === g.label).length;
      m.set(g.label, mine - onlyGroup);
    }
    return m;
  }, [state, date, ready, filterGroup]);
  // 絞っているとき、ほかのグループの担当未定・担当あと n 人（隠れた列で見落とさないように一文で）
  const otherShort = useMemo(() => {
    if (!ready || !filterGroup) return { total: 0, text: "" };
    const mine = new Map(shortageGroups(state, date, filterGroup).map((g) => [g.label, g.count]));
    const parts = shortageGroups(state, date)
      .map((g) => ({ label: g.label, count: g.count - (mine.get(g.label) ?? 0) }))
      .filter((g) => g.count > 0);
    return { total: parts.reduce((n, g) => n + g.count, 0), text: parts.map((g) => `${g.label} ${g.count}`).join("・") };
  }, [state, date, ready, filterGroup]);
  // 終わりの時刻を過ぎて「終わった」の印が無い枠（決定記録 0010 決定 3）。担当未定とは別に数える
  const unfinished = useMemo(() => (ready && now !== null ? unfinishedTasks(state, date, now, filterGroup).length : 0), [state, date, ready, now, filterGroup]);
  const updated = updatedAtLabel(state.days[date]?.updatedAt);
  // 時間割があるか（絞り込みや［利用者］で列が空でも、朝の帯は出さない）
  const hasTasks = ready && Object.values(state.tasks).some((t) => t.date === date && t.status === "planned");

  // 開いたとき、現在時刻の1時間前へ寄せる（時間の切替ボタンは置かない）。横に並べるもの・見るグループを変えたときも寄せ直す
  // （［利用者ごと］に切り替えた直後に 6:00 からの空白が出ないように。ループ 16）
  const scrolled = useRef(false);
  const viewKey = `${view}:${groupId ?? ""}`;
  const lastViewKey = useRef(viewKey);
  useEffect(() => {
    if (lastViewKey.current !== viewKey) {
      lastViewKey.current = viewKey;
      scrolled.current = false;
    }
    if (!ready || now === null || scrolled.current || !scroller.current) return;
    const target = Math.max(0, (now - 60 - VIEW_START) * PX_PER_MIN);
    scrolled.current = true;
    // 描き終わる前は高さが足りず 0 に戻されることがある（負荷が高いとき）。届くまで数フレーム寄せ直す
    let tries = 0;
    const put = () => {
      const el = scroller.current;
      if (!el) return;
      el.scrollTop = target;
      if (Math.abs(el.scrollTop - target) > 2 && el.scrollHeight - el.clientHeight < target && tries++ < 30) requestAnimationFrame(put);
    };
    put();
  }, [ready, now, viewKey]);

  // 見出しの「担当未定 n件」を押すと、該当するカードへ順に移動する（押すたびに次へ）
  const jumpIndex = useRef<Record<string, number>>({});
  // 印や担当が変わったら、巡回を先頭（いちばん早い時刻）からやり直す（1 件終わった直後に次を飛ばさない）
  useEffect(() => {
    jumpIndex.current = {};
  }, [state]);
  // 職員表示から押したら、グループ表示に戻してから（描き終わったあとの effect で）カードへ寄せる
  const pendingJump = useRef<string | null>(null);
  const jumpTo = (label: string) => {
    // 職員・利用者の表示からは、グループの表示に戻してから寄せる（同じ枠が列の数だけ並ぶ・列に出ない枠がある）
    if (view !== "group") {
      pendingJump.current = label;
      setView("group");
      return;
    }
    jumpToCard(label);
  };
  useEffect(() => {
    if (view !== "group" || !pendingJump.current) return;
    const label = pendingJump.current;
    pendingJump.current = null;
    jumpToCard(label);
    // 表示を切り替えた直後に 1 回だけ寄せる（jumpToCard は描画ごとに作り直すので依存に入れない）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);
  function jumpToCard(label: string) {
    const root = scroller.current;
    if (!root) return;
    const selector = label === UNFINISHED ? "[data-task-id][data-unfinished]" : `[data-task-id][data-badge="${label}"]`;
    // 見るグループを選んでいるときは、そのグループの枠を先に、共通の枠をあとに（ループ 14 #13）
    const own = (el: HTMLElement) => (filterGroup && el.dataset.group !== filterGroup ? 1 : 0);
    const cards = Array.from(root.querySelectorAll<HTMLElement>(selector)).sort(
      (a, b) => own(a) - own(b) || a.getBoundingClientRect().top - b.getBoundingClientRect().top || a.getBoundingClientRect().left - b.getBoundingClientRect().left,
    );
    if (cards.length === 0) return;
    const i = (jumpIndex.current[label] ?? -1) + 1;
    jumpIndex.current[label] = i % cards.length;
    const el = cards[i % cards.length];
    // 動きを減らす設定では、滑らかなスクロールと光る枠を止め、枠を2秒だけ付ける
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", inline: "nearest", behavior: reduce ? "auto" : "smooth" });
    el.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    if (reduce) {
      el.style.outline = "3px solid var(--cn-alert-line)";
      window.setTimeout(() => (el.style.outline = ""), 2000);
    } else {
      el.animate([{ boxShadow: "0 0 0 4px var(--cn-alert-line)" }, { boxShadow: "0 0 0 0 transparent" }], { duration: 1200 });
    }
  }

  const moveInColumn = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-card-title]"));
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (i < 0 || items.length === 0) return;
    e.preventDefault();
    const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : Math.min(items.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)));
    items[next].focus();
  };
  // 操作のあとのお知らせ（トースト）。8秒で消えるが「元に戻す」はツールバーに残る
  const [toast, setToast] = useState<string | null>(null);
  // 欠勤・早退／付き添い・外出（スマホの全体と同じ流れを PC でも開く。グリル U3）
  const [flow, setFlowState] = useState<"absence" | "escort" | null>(null);
  // 閉じたら、開いたボタンへフォーカスを戻す（Sheet は戻さない）
  const flowOpener = useRef<HTMLElement | null>(null);
  const setFlow = useCallback((f: "absence" | "escort" | null) => {
    if (f) {
      flowOpener.current = document.activeElement as HTMLElement | null;
      setFlowState(f);
      return;
    }
    setFlowState(null);
    const el = flowOpener.current;
    window.setTimeout(() => {
      if (el && document.contains(el)) el.focus();
      else document.getElementById("board-title")?.focus();
    }, 0);
  }, []);
  const applyFlow = useCallback(
    async (events: Event[], label: string) => {
      if (!engine || events.length === 0) return;
      await engine.dispatch(events, withShortageNote(engine.state, events, label));
      setFlow(null);
    },
    [engine, setFlow],
  );
  // 業務の詳細（カードの名前を押すと開く）
  // ドラッグで止めたときのお知らせ（元に戻すものはないので、ボタンなし）
  const [notice, setNotice] = useState<string | null>(null);
  // 設定の「登録する」から来たときの知らせ（取り込めなかった行があれば、次の1手と一緒に）。閉じるまで出す
  // 横にはみ出しているか（1280 幅などでは右の列がスクロールの先にある。見出しに「→ 右に続き」を出す）
  const [overflowX, setOverflowX] = useState(false);
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const check = () => setOverflowX(root.scrollWidth > root.clientWidth + 2);
    check();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(check) : null;
    ro?.observe(root);
    return () => ro?.disconnect();
  }, [ready, view, colTemplate]);
  const [setupNote, setSetupNote] = useState<{ text: string; residentErrors: number; staffErrors: number } | null>(null);
  const setupNoteRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(SETUP_NOTE_KEY);
      if (raw) {
        window.sessionStorage.removeItem(SETUP_NOTE_KEY);
        setSetupNote(JSON.parse(raw));
        // 利用者の操作（登録する）の結果なので、知らせへフォーカスを移す
        window.setTimeout(() => setupNoteRef.current?.focus(), 0);
      }
    } catch {
      // 読めない端末では出さない
    }
  }, []);
  const showNotice = useCallback((text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice(null), 6000);
  }, []);
  // 右のパネル: 業務の詳細（カードの名前）／担当の追加（カードの「＋」）
  const [panel, setPanel] = useState<{ mode: "detail" | "assign"; taskId: string } | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const openPanel = (mode: "detail" | "assign", taskId: string) => {
    if (!panel) openerRef.current = document.activeElement as HTMLElement | null;
    setPanel({ mode, taskId });
  };
  const openDetail = (id: string) => openPanel("detail", id);
  // 担当の足りない短い枠は、札を業務名の下の段に（1 行に詰めると「お.担当あと1人」と重なる。ループ 19 #14）
  const isShort = (taskId: string) => {
    const l = headcountStatus(state, taskId).level;
    return l === "unassigned" || l === "short";
  };
  // 列の見出しの帯の色（グループの並び順で回す。共通は灰色。決定記録 0019）
  const groupColor = (id?: string): string => {
    const g = id ? state.groups[id] : undefined;
    if (!g || g.kind === "common") return "var(--cn-group-common)";
    const order = Object.values(state.groups)
      .filter((x) => x.kind !== "common")
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .findIndex((x) => x.id === g.id);
    return `var(--cn-group-${(order % 4) + 1})`;
  };
  const openAssign = (id: string) => openPanel("assign", id);
  const closePanel = useCallback(() => {
    const opener = openerRef.current;
    const taskId = panel?.taskId;
    setPanel(null);
    // 開いたチップが消えていたら（外したあと）、そのカードの業務名へ
    window.setTimeout(() => {
      if (opener && opener.isConnected) opener.focus();
      else if (taskId) document.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(taskId)}"] [data-card-title]`)?.focus();
    }, 0);
  }, [panel]);
  // 新しい操作のときだけトーストを出す（元に戻して前の操作が先頭に戻ってきたときは出さない）
  const seenBatches = useRef(new Set<string>());
  // 開く前の操作（ほかの画面・前の日）のトーストは出さない。元に戻すはツールバーに残る
  const openedAt = useRef(new Date().toISOString());
  const lastLabel = lastUndo ? `${lastUndo.batchId}` : "";
  useEffect(() => {
    if (!lastUndo || seenBatches.current.has(lastUndo.batchId)) return;
    seenBatches.current.add(lastUndo.batchId);
    if (lastUndo.at < openedAt.current) return;
    setToast(lastUndo.label);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastLabel]);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 8000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const hours: number[] = [];
  for (let m = VIEW_START; m < gridEnd; m += 60) hours.push(m);
  const nowInView = now !== null && now >= VIEW_START && now < gridEnd;

  return (
    <>
      {/* スマホ幅: ボード（表）は出さず、1文と1ボタン（docs/screens.md §1） */}
      {!forceBoard && (
        <div className="flex min-h-screen flex-col items-start gap-4 p-5 md:hidden print:!hidden">
          <p className="text-[17px] font-bold">ボードは PC・タブレット用の画面です。</p>
          <p className="text-[16px] text-[var(--cn-ink-soft)]">スマホでは、きょうの自分の予定を見られます。</p>
          <Link href="/me" className="inline-flex h-[48px] items-center rounded-xl bg-[var(--cn-accent)] px-5 text-[16px] font-bold text-white">
            自分の予定を開く
          </Link>
        </div>
      )}
    <div className={`${forceBoard ? "flex" : "hidden md:flex"} h-screen flex-col print:!hidden`}>
      <a href={view === "staff" ? "#watch-lines" : "#staff-palette"} className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-2">
        {view === "staff" ? "見守りのつながりへ移動" : "出勤者一覧へ移動"}
      </a>
      {/* 上部バー（1段） */}
      <TopBar current="board">
        <DateNav date={date} today={defaultDate} />
        {isSampleFacility(state) ? (
          <span className="text-[14px] text-[var(--cn-muted)]">サンプル施設の一日</span>
        ) : (
          updated && <span className="text-[14px] text-[var(--cn-muted)]">{updated}</span>
        )}
        <SyncBadge />
      </TopBar>

      {/* ツールバー（1段） */}
      <section
        aria-label="ボードの表示と操作"
        className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 px-5 py-2.5" /* 2 段: 上＝見るグループ・横に並べる・元に戻す・⋯／下＝件数の札・欠勤・付き添い（ループ 14 #14） */
      >
        {/* 表示を切り替えたら読み上げで知らせる（ループ 14 #22） */}
        <p role="status" className="sr-only">
          {hasTasks ? `${(view === "resident" ? residentGroup : groupId) ? state.groups[(view === "resident" ? residentGroup : groupId)!]?.name : "すべてのグループ"}を${view === "group" ? "グループごと" : view === "staff" ? "職員ごと" : "利用者ごと"}に表示しています` : ""}
        </p>
        {hasTasks && (
          <label className="flex items-center gap-2 text-[15px]">
            見るグループ
            <select
              value={(view === "resident" ? residentGroup : groupId) ?? ""}
              onChange={(e) => setViewGroup(e.target.value)}
              className="h-[44px] rounded-lg border border-[var(--cn-control-line)] bg-white px-2.5 text-[15px] font-bold"
            >
              <option value="" disabled={view === "resident"}>
                {view === "resident" ? "すべて（利用者ごとでは選べません）" : "すべて"}
              </option>
              {Object.values(state.groups)
                .filter((g) => g.kind !== "common")
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        {hasTasks && (
          <div className="flex items-center gap-2">
          <span id="axis-label" className="text-[15px]">
            横に並べる
          </span>
          <div role="group" aria-label="横軸" aria-describedby="axis-label" className="inline-flex rounded-lg border border-[var(--cn-card-line)] bg-white p-0.5">
            {(
              [
                ["group", "グループごと"],
                ["staff", "職員ごと"],
                ["resident", "利用者ごと"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className={`h-[44px] min-w-[72px] rounded-md px-3 text-[15px] ${view === v ? "bg-[var(--cn-accent-soft)] font-bold text-[var(--cn-accent)] ring-2 ring-inset ring-[var(--cn-accent)]" : "text-[var(--cn-ink-soft)]"}`}
              >
                {label}
              </button>
            ))}
          </div>
          </div>
        )}
        {hasTasks && <div aria-hidden="true" className="order-3 h-0 basis-full" />}
        {hasTasks && (
          <div className="order-4 flex flex-wrap items-center gap-2" /* 件数の変化はトーストで知らせる（ここで読み上げると二重になる） */>
            {groups.map((g) => (
              <button
                type="button"
                key={g.label}
                onClick={() => jumpTo(g.label)}
                aria-label={`${g.label} ${g.count}件${filterGroup && (commonShort.get(g.label) ?? 0) > 0 ? `（${state.groups[filterGroup]?.name} ${g.count - (commonShort.get(g.label) ?? 0)}・共通 ${commonShort.get(g.label)}）` : ""}。押すと次の枠へ移動`}
                className={`inline-flex h-[44px] items-center rounded-full border border-[var(--cn-alert-line)] px-3.5 text-[14px] font-bold ${
                  g.level === "unassigned" ? "bg-[var(--cn-unassigned-bg)] text-[var(--cn-unassigned-ink)]" : "bg-[var(--cn-short-bg)] text-[var(--cn-short-ink)]"
                }`}
              >
                {g.label} {g.count}件
                {filterGroup && (commonShort.get(g.label) ?? 0) > 0 && (
                  <span className="ml-1 font-normal">
                    （{state.groups[filterGroup]?.name} {g.count - (commonShort.get(g.label) ?? 0)}・共通 {commonShort.get(g.label)}）
                  </span>
                )}{" "}
                →
              </button>
            ))}
            {groups.length === 0 && <span className="text-[14px] text-[var(--cn-muted)]">{filterGroup ? "このグループの枠には、すべて担当が付いています" : "すべての枠に担当が付いています"}</span>}
            {otherShort.total > 0 && (
              <button
                type="button"
                onClick={() => {
                  setViewGroupRaw("");
                  setViewRaw("group");
                  saveBoardView({ axis: "group", group: "" });
                }}
                className="inline-flex h-[44px] items-center whitespace-nowrap rounded-full border border-[var(--cn-control-line)] bg-white px-3 text-[14px] text-[var(--cn-ink)]"
              >
                ほかのグループ: {otherShort.text}（すべてを見る）
              </button>
            )}
            {unfinished > 0 && (
              <button
                type="button"
                onClick={() => jumpTo(UNFINISHED)}
                aria-label={`${UNFINISHED} ${unfinished}件。時刻を過ぎて、終わったの印が無い枠。押すと次の枠へ移動`}
                className="inline-flex h-[44px] items-center rounded-full border border-[var(--cn-control-line)] bg-white px-3.5 text-[14px] font-bold text-[var(--cn-ink)]"
              >
                {UNFINISHED} {unfinished}件 →
              </button>
            )}
            <button
              type="button"
              aria-expanded={noteOpen}
              aria-controls="board-note"
              aria-label="この数字について"
              onClick={() => setNoteOpen((v) => !v)}
              className="inline-flex h-[44px] w-[44px] items-center justify-center rounded-full text-[16px] text-[var(--cn-muted)] hover:bg-white"
            >
              ⓘ
            </button>

          </div>
        )}
        {hasTasks && (
          <div className="order-5 flex items-center gap-2">
            <button type="button" onClick={() => setFlow("absence")} className="inline-flex h-[44px] items-center rounded-lg border border-[var(--cn-control-line)] bg-white px-3.5 text-[15px] font-bold">
              欠勤・早退
            </button>
            <button type="button" onClick={() => setFlow("escort")} className="inline-flex h-[44px] items-center rounded-lg border border-[var(--cn-control-line)] bg-white px-3.5 text-[15px] font-bold">
              付き添い・外出
            </button>
          </div>
        )}
        <div className="order-2 ml-auto flex items-center gap-2">
        {viewUndo && (
          <button
            type="button"
            onClick={async () => {
              const done = await engine?.undo(viewUndo.batchId);
              // 戻した結果は「元に戻す」の無いお知らせで（戻した直後にまた元に戻すを出さない。ループ 18）
              setToast(null);
              if (done) showNotice(`元に戻しました（取り消した操作: ${done.label.replace(/。いま .*$/, "")}）`);
            }}
            className="inline-flex h-[44px] items-center gap-2 rounded-lg border border-[var(--cn-card-line)] bg-white px-4 text-[14px]"
          >
            元に戻す<span className="text-[13px] text-[var(--cn-muted)]">（{viewUndo.label}）</span>
          </button>
        )}
        {hasTasks && <BoardMenu state={state} engine={engine} date={date} dateShort={`${Number(date.slice(5, 7))}/${Number(date.slice(8))}`} onPrint={printSheet} onNotice={showNotice} />}
        </div>
      </section>

      {setupNote && (!hasTasks || setupNote.residentErrors + setupNote.staffErrors > 0) && (
        <div
          ref={setupNoteRef}
          tabIndex={-1}
          className="mx-5 mb-3 flex flex-wrap items-center gap-3 rounded-xl border-2 border-[var(--cn-accent)] bg-[var(--cn-accent-soft)] px-4 py-2.5 text-[15px] outline-none"
        >
          <span className="min-w-0 flex-1">
            {setupNote.text}
            {hasTasks ? "" : " 下の「今日の時間割を作る」で、今日来る人の「出勤にする」を押してください。"}
          </span>
          {setupNote.residentErrors > 0 && (
            <Link href="/residents" className="inline-flex h-[44px] items-center rounded-lg border border-[var(--cn-control-line)] bg-white px-4 font-bold">
              利用者で足す（{setupNote.residentErrors}行）
            </Link>
          )}
          {setupNote.staffErrors > 0 && (
            <Link href="/setup" className="inline-flex h-[44px] items-center rounded-lg border border-[var(--cn-control-line)] bg-white px-4 font-bold">
              設定で職員を足す（{setupNote.staffErrors}行）
            </Link>
          )}
          <button
            type="button"
            onClick={() => {
              setSetupNote(null);
              document.getElementById("board-title")?.focus();
            }}
            className="h-[44px] rounded-lg border border-[var(--cn-control-line)] bg-white px-4"
          >
            閉じる
          </button>
        </div>
      )}

      {noteOpen && hasTasks && (
        <p id="board-note" className="mx-5 mb-2 rounded-lg border border-[var(--cn-control-line)] bg-white px-3 py-2 text-[14px] text-[var(--cn-ink-soft)]">
          担当未定・担当あと n 人: 決めた人数にあと何人足りないか、です。終わっていない: 終わりの時刻を過ぎて「終わった」の印が無い枠の数です。どちらもケアができていない数ではありません。
        </p>
      )}
      {/* 本体 */}
      <BoardDnd engine={engine} onNotice={showNotice}>
      <main className="flex min-h-0 flex-1 gap-4 px-5 pb-5">
        <section aria-label="時間割" className="relative min-w-0 flex-1 overflow-hidden rounded-xl border border-[var(--cn-border)] bg-white">
          {/* 右の列がスクロールの先にあるとき（1280 幅など）の手掛かり。列の見出しを隠さないよう、時間割の右下に重ねる */}
          {overflowX && hasTasks && view === "group" && (
            <div className={`pointer-events-none absolute bottom-2 right-4 z-30 rounded bg-white/95 px-2 py-1 text-[14px] font-bold text-[var(--cn-ink-soft)] shadow`} role="note">
              → 右に続き（横にスクロール）
            </div>
          )}
          <h2 id="board-title" tabIndex={-1} className="sr-only">
            {weekdayLabel(date)}の時間割
          </h2>
          {!ready ? (
            <div className="p-6 text-[var(--cn-muted)]">{loaded && syncInfo.kind === "sync" ? <SyncEmpty /> : "読み込んでいます…"}</div>
          ) : !hasTasks ? (
            <MorningBand key={date} state={state} date={date} />
          ) : view === "staff" ? (
            <StaffView state={state} date={date} now={now} onOpen={openDetail} groupId={groupId} />
          ) : view === "resident" && columns.length === 0 ? (
            <div className="p-6 text-[15px]">
              利用者がまだいません。利用者の画面で足すと、方ごとの列が出ます。{" "}
              <Link href="/residents" className="inline-flex min-h-[44px] items-center font-bold text-[var(--cn-accent)] underline">
                利用者の画面へ
              </Link>
            </div>
          ) : (
            <div className="flex h-full flex-col">
            {view === "resident" && (
              <p id="resident-note" className="shrink-0 border-b border-[var(--cn-grid)] px-3 py-1.5 text-[14px] text-[var(--cn-ink-soft)]">
                {groupId && residentGroup !== groupId ? `${state.groups[groupId]?.name}には利用者がいないので、` : ""}
                {residentGroup ? state.groups[residentGroup]?.name : ""}の方ごとの枠です。何人かが対象の枠（「n人の枠」）は、その方々の列に同じ 1 枚が出ます（担当の追加と「終わった」の印は、押して開く詳細で。印は枠に 1 つです）。対象の方が決まっていない枠（見守り・共通・休憩など）は［グループごと］で見ます。
                {overflowX && <strong className="ml-1 whitespace-nowrap">→ 右に続き（横にスクロール）</strong>}
              </p>
            )}
            <div ref={scroller} className="min-h-0 flex-1 overflow-auto" data-testid="board-scroller">
              {/* 列見出し */}
              <div
                className="sticky top-0 z-20 grid border-b border-[var(--cn-border)] bg-white"
                style={{ gridTemplateColumns: colTemplate }}
              >
                <div className="sticky left-0 z-10 bg-white px-2 py-2.5 text-[13px] text-[var(--cn-muted)]">時刻</div>

                {columns.map((c) => (
                  <h2
                    key={c.id}
                    id={`col-${c.id}`}
                    className="border-l border-t-4 border-[var(--cn-grid)] px-3 py-2 font-bold"
                    style={{ borderTopColor: groupColor(view === "resident" ? residentGroup : c.id) }}
                    title={view === "resident" ? c.sub : undefined}
                  >
                    <span>{c.name}</span> {view !== "resident" && c.sub && <span className="text-[14px] font-normal text-[var(--cn-muted)]">{c.sub}</span>}
                  </h2>
                ))}
              </div>
              {/* 時間割 */}
              <div
                className="relative grid"
                style={{
                  gridTemplateColumns: colTemplate,
                  height: (gridEnd - VIEW_START) * PX_PER_MIN,
                  backgroundImage: "linear-gradient(var(--cn-grid) 1px, transparent 1px)",
                  backgroundSize: `100% ${60 * PX_PER_MIN}px`,
                }}
              >
                <div className="sticky left-0 z-[5] bg-white text-[14px] text-[var(--cn-muted)]">
                  {hours.map((m) => (
                    <div key={m} className="absolute left-2" style={{ top: (m - VIEW_START) * PX_PER_MIN + 4 }}>
                      {m === VIEW_END ? <span className="font-bold text-[var(--cn-ink)]">{fmtMin(m)}</span> : fmtMin(m)}
                    </div>
                  ))}
                </div>
                {columns.map((c) => (
                  <div
                    key={c.id}
                    className="relative border-l border-[var(--cn-grid)]"
                    role={view === "resident" ? "group" : undefined}
                    aria-labelledby={view === "resident" ? `col-${c.id}` : undefined}
                    // 利用者ごとの列の中は ↑↓・Home・End で枠を移る（ループ 14 #6）
                    onKeyDown={view === "resident" ? moveInColumn : undefined}
                  >
                    {c.cards.map(({ task, lane, lanes, rail }) => {
                      const top = (task.startMin - VIEW_START) * PX_PER_MIN;
                      // 15分の業務でも「＋」(44px) が収まる高さを確保する
                      const height = Math.max(MIN_VISUAL_MIN * PX_PER_MIN, (task.endMin - task.startMin) * PX_PER_MIN);
                      // レールは左 RAIL_WIDTH%、残りの業務はその右の幅を段数で割る
                      const areaLeft = rail ? 0 : c.hasRail ? RAIL_WIDTH : 0;
                      const areaWidth = rail ? RAIL_WIDTH : 100 - areaLeft;
                      const left = areaLeft + (areaWidth * lane) / lanes;
                      const width = areaWidth / lanes;
                      return (
                        <DropZone key={task.id} id={view === "resident" ? `task:${task.id}:${c.id}` : `task:${task.id}`} data={{ kind: "task", taskId: task.id }} className="absolute z-[2] p-[3px]" style={{ top, height, left: `${left}%`, width: `${width}%` }}>
                          {view === "resident" && (state.targets[task.id] ?? []).length > 1 ? (
                            <SharedTaskCard state={state} task={task} onOpen={openDetail} columnName={c.name} />
                          ) : (
                            <TaskCard
                              state={state}
                              task={task}
                              now={now}
                              // 細いとき、1 行に業務名・担当のチップ・＋を詰める形（compact）は業務名が潰れる。
                              // 同じ時刻に横に並ぶ短い枠は細い形（narrow: 業務名・時刻と＋、担当は名字の文字）、利用者ごとの列は 2 段の形にする
                              variant={
                                rail
                                  ? "rail"
                                  : height < 84
                                    ? "mini"
                                    : height < 150 && (lanes > 1 || isShort(task.id))
                                      ? "narrow"
                                      : height < 150 && view !== "resident"
                                        ? "compact"
                                        : "normal"
                              }
                              onOpen={openDetail}
                              onAdd={openAssign}
                              instanceKey={view === "resident" ? c.id : undefined}
                              tight={lanes > 1}
                            />
                          )}
                        </DropZone>
                      );
                    })}
                  </div>
                ))}
                {gridEnd > VIEW_END && (
                  <div aria-hidden="true" className="pointer-events-none absolute left-0 right-0 z-[6] border-t-2 border-dashed border-[var(--cn-control-line)]" style={{ top: (VIEW_END - VIEW_START) * PX_PER_MIN }}>
                    <span className="absolute left-16 -translate-y-1/2 rounded bg-white px-1.5 text-[14px] text-[var(--cn-ink-soft)]">ここから翌朝（{shortDateOf(addDays(date, 1))} 6:00 以降。きょうの夜勤の人の分）</span>
                  </div>
                )}
                {nowInView && (
                  <>
                    {/* 線はカードの後ろ（業務名を横切って取り消し線に見えないように。決定記録 0019）。時刻の札は前 */}
                    <div aria-hidden="true" className="pointer-events-none absolute left-0 right-0 z-[1]" style={{ top: (now! - VIEW_START) * PX_PER_MIN }}>
                      <div className="ml-16 border-t-2 border-[var(--cn-now)]" />
                    </div>
                    <div aria-hidden="true" className="pointer-events-none absolute left-0 z-10" style={{ top: (now! - VIEW_START) * PX_PER_MIN }}>
                      <div className="absolute left-1 -translate-y-1/2 cn-now-label rounded bg-[var(--cn-now)] px-1.5 text-[13px] font-bold text-white">{fmtMin(now!)}</div>
                    </div>
                  </>
                )}
              </div>
            </div>
            </div>
          )}
        </section>

        {/* 右パレット（職員表示では行が職員なので出さない） */}
        {hasTasks && view !== "staff" && (
        <aside id="staff-palette" aria-label="きょうの出勤者" className="flex w-[280px] shrink-0 flex-col gap-3 overflow-auto">
          <DropZone id="palette" data={{ kind: "palette" }}>
          <div className="rounded-xl border border-[var(--cn-border)] bg-white p-3.5">
            <div className="flex items-baseline gap-2">
              <span className="font-bold">きょうの出勤者</span>
              <span className="text-[13px] text-[var(--cn-muted)]">{palette.working.length}人</span>
            </div>
            <ul className="mt-2.5 flex flex-col gap-1.5">
              {palette.working.map((r) => {
                const later = now !== null && r.startMin > now;
                return (
                  <li key={r.staffId}>
                    <PaletteStaff staffId={r.staffId} later={later}>
                      <span className="shrink-0 font-bold">{r.surname}</span>
                      {r.firstTimer && <span className="shrink-0 rounded border border-[var(--cn-card-line)] bg-white px-1.5 text-[13px]">初回</span>}
                      <span className="min-w-0 truncate text-[13px] text-[var(--cn-muted)]">{r.slotName}</span>
                      <span className="ml-auto shrink-0 whitespace-nowrap text-[13px] text-[var(--cn-muted)]">
                        {later ? `${fmtMin(r.startMin)}から` : fmtRange(r.startMin, r.endMin)}
                      </span>
                    </PaletteStaff>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-[13px] text-[var(--cn-muted)]">名前をカードへ動かすと担当になります。カードの名前をここへ戻すと外れます。</p>
          </div>
          </DropZone>
          <AddTodayPerson state={state} date={date} now={now} />
          {palette.off.length > 0 && (
            <section aria-labelledby="off-title" className="rounded-xl border border-[var(--cn-border)] bg-white p-3.5">
              <h2 id="off-title" className="font-bold">休み</h2>
              <ul className="mt-2 flex flex-col gap-1.5">
                {palette.off.map((r) => (
                  <li key={r.staffId} className="rounded-[10px] bg-[var(--cn-ground)] px-3 py-2 text-[14px] text-[var(--cn-ink-soft)]">
                    <span className="font-bold">{r.surname}</span> {r.slotName}
                    {r.unfilledSlotTasks > 0 && (
                      <span className="block text-[13px]">
                        {r.surname}さんの分 {r.unfilledSlotTasks}件（
                        {r.slotTaskLabels.map((x) => `${x.label} ${x.count}`).join("・")}
                        ）
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
        )}
      </main>
      </BoardDnd>
      {flow === "absence" && engine && (
        <AbsenceFlow state={state} engine={engine} date={date} clock={clockNow ?? 9 * 60} onClose={() => setFlow(null)} onApply={applyFlow} />
      )}
      {flow === "escort" && engine && (
        <EscortFlow state={state} engine={engine} date={date} now={businessMinutes(clockNow ?? 9 * 60)} onClose={() => setFlow(null)} onApply={applyFlow} />
      )}
      {panel?.mode === "detail" && <TaskDetail key={panel.taskId} state={state} engine={engine} taskId={panel.taskId} onClose={closePanel} onAdd={openAssign} />}
      {panel?.mode === "assign" && <AssignPanel key={panel.taskId} state={state} engine={engine} taskId={panel.taskId} onClose={closePanel} onDetail={openDetail} />}
      <div id="board-toast" role="status" aria-live="polite" className="pointer-events-none fixed bottom-5 left-1/2 z-40 -translate-x-1/2">
        {notice && !toast && (
          <div className="pointer-events-auto rounded-[10px] bg-[var(--cn-toast-bg)] text-[var(--cn-toast-ink)] border border-[var(--cn-toast-line)] px-4 py-3 text-[15px] shadow-lg">{notice}</div>
        )}
        {toast && (
          <div className="pointer-events-auto flex items-center gap-3 rounded-[10px] bg-[var(--cn-toast-bg)] text-[var(--cn-toast-ink)] border border-[var(--cn-toast-line)] px-4 py-3 text-[15px] shadow-lg">
            <span>{toast}</span>
            <button
              type="button"
              onClick={async () => {
                setToast(null);
                const done = await engine?.undo();
                if (done) showNotice(`元に戻しました（取り消した操作: ${done.label}）`);
              }}
              className="h-[44px] shrink-0 whitespace-nowrap rounded-md border border-[var(--cn-toast-ink)] px-3 text-[14px] font-bold"
            >
              元に戻す
            </button>
          </div>
        )}
      </div>
    </div>
      {ready && hasTasks && <StaffSheetPrint state={state} date={date} dateLabel={weekdayLabel(date)} printedAt={printedAt} />}
    </>
  );
}

/** パレットの出勤者（ドラッグしてカードへ） */
function PaletteStaff({ staffId, later, children }: { staffId: string; later: boolean; children: React.ReactNode }) {
  const { dragProps, setNodeRef, style, isDragging } = useStaffDrag(`staff:${staffId}`, { kind: "staff", staffId });
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...dragProps}
      style={style}
      aria-roledescription="ドラッグできる職員"
      className={`flex min-h-[44px] w-full cursor-grab touch-none items-center gap-2.5 rounded-[10px] border px-3 py-2 text-left ${
        later ? "border-[var(--cn-border)] bg-[var(--cn-ground)]" : "border-[var(--cn-card-line)] bg-white"
      } ${isDragging ? "shadow-lg" : ""}`}
    >
      {children}
    </button>
  );
}

/** 日付と、前の日／次の日／今日への移動（ボードの上部バー） */
function DateNav({ date, today }: { date: string; today: string | null }) {
  const link = "inline-flex h-[44px] items-center rounded-lg px-2.5 text-[15px] text-[var(--cn-ink-soft)] hover:bg-[var(--cn-ground)]";
  const href = (d: string) => (d === today ? "/board" : `/board?date=${d}`);
  const prev = addDays(date, -1);
  const next = addDays(date, 1);
  const router = useRouter();
  const picker = useRef<HTMLInputElement>(null);
  // カレンダーを開けないブラウザでは、見える日付の欄を出す（隠した欄へフォーカスを送らない。ループ 19）
  const [fallback, setFallback] = useState(false);
  const go = (v: string) => {
    if (!v) return;
    setFallback(false);
    router.push(href(v));
  };
  return (
    <nav aria-label="日付" className="flex items-center gap-1">
      <Link href={href(prev)} className={link} aria-label={`前の日（${shortDateOf(prev)}）`}>
        ‹ 前の日
      </Link>
      {/* 日付を押すとカレンダーで日を選べる（勤務表を入れた先の日へ「次の日」を何度も押さない。ループ 12 #25） */}
      <span className="relative">
        <button
          type="button"
          aria-current={date === today ? "date" : undefined}
          aria-label={`${weekdayLabel(date)}${today && date !== today ? "（今日ではありません）" : ""}。押すと日付を選べます`}
          onClick={() => {
            const el = picker.current;
            if (!el) return;
            try {
              el.showPicker();
            } catch {
              setFallback(true);
            }
          }}
          className="inline-flex h-[44px] items-center rounded-lg px-2 text-[16px] font-bold underline decoration-dotted underline-offset-4 hover:bg-[var(--cn-ground)]"
        >
          {weekdayLabel(date)}
        </button>
        <input
          ref={picker}
          type="date"
          tabIndex={-1}
          aria-hidden="true"
          value={date}
          onChange={(e) => go(e.target.value)}
          className="pointer-events-none absolute bottom-0 left-0 h-px w-px opacity-0"
        />
      </span>
      {fallback && (
        <input
          type="date"
          aria-label="日付を選ぶ"
          autoFocus
          defaultValue={date}
          onChange={(e) => go(e.target.value)}
          className="h-[44px] rounded-lg border border-[var(--cn-control-line)] bg-white px-2 text-[16px]"
        />
      )}
      <Link href={href(next)} className={link} aria-label={`次の日（${shortDateOf(next)}）`}>
        次の日 ›
      </Link>
      {today && today !== date && (
        <Link href="/board" className={`${link} border border-[var(--cn-control-line)] bg-white font-bold text-[var(--cn-accent)]`}>
          今日へ
        </Link>
      )}
    </nav>
  );
}

/**
 * 時間割を作ったあとで「今日来る人を足す」（グリル U2）。名前と番を選ぶ →「この内容で決定」。
 * その番の業務のうち、勤務時間の中で担当が足りない枠に入る。1 回で元に戻せる。
 */
function AddTodayPerson({ state, date, now }: { state: State; date: string; now: number | null }) {
  const engine = useEngine();
  const [open, setOpenState] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  // 閉じたら「＋ 今日来る人を足す」へフォーカスを戻す
  const setOpen = (v: boolean) => {
    setOpenState(v);
    if (!v) window.setTimeout(() => opener.current?.focus(), 0);
  };
  const [staffId, setStaffId] = useState("");
  const [slotId, setSlotId] = useState("");
  // 初回の印（応援・スポットで初めて来た人。既定は職種がスポットで初めての人）
  const [first, setFirst] = useState<boolean | null>(null);
  const firstTimer = first ?? (staffId ? isFirstTimeDefault(state, staffId, date) : false);
  const working = new Set(Object.values(state.roster).filter((e) => e.date === date && !e.absent).map((e) => e.staffId));
  const candidates = Object.values(state.staff).filter((s) => !working.has(s.id));
  const slots = Object.values(state.roleSlots).sort((a, b) => a.sortOrder - b.sortOrder);
  if (candidates.length === 0) return null;
  const decide = async () => {
    if (!engine || !staffId || !slotId) return;
    const events = addTodayPersonEvents(engine.state, date, staffId, slotId, engine.context(), { nowMin: now ?? undefined, firstTimer });
    const name = state.staff[staffId]?.surname ?? "";
    // 人の名前の横に件数を出さない（原則 5）
    const any = events.some((e) => e.type === "assignment.add");
    await engine.dispatch(events, `${name}さんを${state.roleSlots[slotId]?.name ?? ""}で足しました${any ? "。その番の、決めた人数に届いていない枠に入れました" : ""}`);
    setOpen(false);
    setStaffId("");
    setSlotId("");
    setFirst(null);
  };
  const select = "h-[44px] w-full rounded-lg border border-[var(--cn-control-line)] bg-white px-2 text-[15px]";
  return (
    <section aria-label="今日来る人を足す" className="rounded-xl border border-dashed border-[var(--cn-muted)] bg-white p-3">
      {!open ? (
        <button ref={opener} type="button" onClick={() => setOpen(true)} className="h-[44px] w-full text-left text-[15px]">
          ＋ 今日来る人を足す
        </button>
      ) : (
        <div className="flex flex-col gap-2">
          <select aria-label="今日来る人" value={staffId} onChange={(e) => setStaffId(e.target.value)} className={select} autoFocus>
            <option value="" disabled>
              名前を選ぶ
            </option>
            {candidates.map((s) => (
              <option key={s.id} value={s.id}>
                {s.surname}（{s.role}）
              </option>
            ))}
          </select>
          <select aria-label="番" value={slotId} onChange={(e) => setSlotId(e.target.value)} className={select}>
            <option value="" disabled>
              番を選ぶ
            </option>
            {slots.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} {fmtRange(s.defaultStartMin, s.defaultEndMin)}
              </option>
            ))}
          </select>
          <label className="flex min-h-[44px] items-center gap-2 text-[15px]">
            <input type="checkbox" className="h-5 w-5" checked={firstTimer} onChange={(e) => setFirst(e.target.checked)} />
            初回（はじめて来た人）
          </label>
          <p className="text-[14px] text-[var(--cn-muted)]">その番の業務のうち、決めた人数に届いていない枠と休憩に入ります（いまより前に終わった枠には入りません）。</p>
          <div className="flex gap-2">
            <button type="button" onClick={decide} disabled={!staffId || !slotId} className="h-[44px] flex-1 rounded-lg bg-[var(--cn-accent)] font-bold text-white disabled:opacity-50">
              この内容で決定
            </button>
            <button type="button" onClick={() => setOpen(false)} className="h-[44px] rounded-lg border border-[var(--cn-control-line)] bg-white px-3">
              やめる
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// ボードの見え方（横軸・見るグループ）を端末で覚える（決定記録 0017）。読めない・書けないときは既定のまま
// ---------------------------------------------------------------------------
type BoardAxis = "group" | "staff" | "resident";
const BOARD_VIEW_KEY = "care-navi:board-view";
function loadBoardView(): { axis: BoardAxis; group: string } | null {
  try {
    const raw = window.localStorage.getItem(BOARD_VIEW_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { axis?: string; group?: string };
    const axis: BoardAxis = v.axis === "staff" || v.axis === "resident" ? v.axis : "group";
    return { axis, group: typeof v.group === "string" ? v.group : "" };
  } catch {
    return null;
  }
}
function saveBoardView(v: { axis: BoardAxis; group: string }) {
  try {
    window.localStorage.setItem(BOARD_VIEW_KEY, JSON.stringify(v));
  } catch {
    // 保存できなくても表示はそのまま
  }
}
