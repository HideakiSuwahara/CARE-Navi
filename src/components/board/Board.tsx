"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { TopBar } from "@/components/TopBar";
import { SETUP_NOTE_KEY } from "@/components/setup/setupNote";
import { useAppState, useEngine, useNowMinutes } from "@/store/react";
import { SyncBadge } from "@/components/SyncBadge";
import { SAMPLE_DATE } from "@/store/sample";
import { boardColumns, paletteRows } from "@/domain/layout";
import { shortageGroups } from "@/domain/checks";
import { fmtMin, fmtRange } from "@/domain/time";
import { updatedAtLabel } from "@/domain/display";
import { addDays } from "@/domain/pattern";
import { TaskCard } from "./TaskCard";
import { MorningBand } from "./MorningBand";
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
const MIN_CARD_WIDTH = 112;
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

export function Board({ date = SAMPLE_DATE }: { date?: string }) {
  const { state, ready } = useAppState();
  const engine = useEngine();
  const lastUndo = useSyncExternalStore(
    (cb) => (engine ? engine.subscribe(cb) : () => {}),
    () => engine?.lastUndo ?? null,
    () => null,
  );
  const now = useNowMinutes();
  const [noteOpen, setNoteOpen] = useState(false);
  // 横軸［グループ｜職員］。職員表示を印刷すると分担表
  const [view, setView] = useState<"group" | "staff">("group");
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

  const columns = useMemo(() => (ready ? boardColumns(state, date, MIN_VISUAL_MIN) : []), [state, date, ready]);
  // 翌 6:00 より後に終わる業務（夜勤明けの朝食・申し送りなど）があれば、時間の軸をそこまで伸ばす（1時間単位）
  const gridEnd = useMemo(() => {
    const maxEnd = Math.max(VIEW_END, ...columns.flatMap((c) => c.cards.map((x) => x.task.endMin)));
    return Math.ceil(maxEnd / 60) * 60;
  }, [columns]);
  // 列の最小幅: 同じ時刻に横に並ぶ枚数に合わせて広げる（カードを細くしすぎない。足りなければ横にスクロール）
  const colTemplate = `64px ${columns
    .map((c) => {
      const min = Math.max(220, Math.ceil((c.maxLanes * MIN_CARD_WIDTH) / (c.hasRail ? 1 - RAIL_WIDTH / 100 : 1)));
      // 余った幅も必要な幅の比で分ける
      return `minmax(${min}px, ${min}fr)`;
    })
    .join(" ")}`;
  const palette = useMemo(() => (ready ? paletteRows(state, date) : { working: [], off: [] }), [state, date, ready]);
  const groups = useMemo(() => (ready ? shortageGroups(state, date) : []), [state, date, ready]);
  const updated = updatedAtLabel(state.days[date]?.updatedAt);
  const hasTasks = columns.some((c) => c.cards.length > 0);

  // 開いたとき、現在時刻の1時間前へ寄せる（時間の切替ボタンは置かない）。グループ表示に戻ったときも寄せ直す
  const scrolled = useRef(false);
  useEffect(() => {
    if (view !== "group") scrolled.current = false;
    if (!ready || now === null || scrolled.current || !scroller.current) return;
    scroller.current.scrollTop = Math.max(0, (now - 60 - VIEW_START) * PX_PER_MIN);
    scrolled.current = true;
  }, [ready, now, view]);

  // 見出しの「担当未定 n件」を押すと、該当するカードへ順に移動する（押すたびに次へ）
  const jumpIndex = useRef<Record<string, number>>({});
  // 職員表示から押したら、グループ表示に戻してから（描き終わったあとの effect で）カードへ寄せる
  const pendingJump = useRef<string | null>(null);
  const jumpTo = (label: string) => {
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
  }, [view]);
  function jumpToCard(label: string) {
    const root = scroller.current;
    if (!root) return;
    const cards = Array.from(root.querySelectorAll<HTMLElement>(`[data-task-id][data-badge="${label}"]`)).sort(
      (a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top || a.getBoundingClientRect().left - b.getBoundingClientRect().left,
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

  // 操作のあとのお知らせ（トースト）。8秒で消えるが「元に戻す」はツールバーに残る
  const [toast, setToast] = useState<string | null>(null);
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
  const lastLabel = lastUndo ? `${lastUndo.batchId}` : "";
  useEffect(() => {
    if (!lastUndo || seenBatches.current.has(lastUndo.batchId)) return;
    seenBatches.current.add(lastUndo.batchId);
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
        <span className="text-[16px] font-bold">{weekdayLabel(date)}</span>
        {updated && <span className="text-[14px] text-[var(--cn-muted)]">{updated}</span>}
        <SyncBadge />
      </TopBar>

      {/* ツールバー（1段） */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 px-5 py-2.5">
        {hasTasks && (
          <div role="group" aria-label="横軸" className="inline-flex rounded-lg border border-[var(--cn-card-line)] bg-white p-0.5">
            {(
              [
                ["group", "グループ"],
                ["staff", "職員"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className={`h-[44px] min-w-[72px] rounded-md px-3 text-[15px] ${view === v ? "bg-[var(--cn-accent-soft)] font-bold text-[var(--cn-accent)]" : "text-[var(--cn-ink-soft)]"}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {hasTasks && (
          <div className="flex items-center gap-2" /* 件数の変化はトーストで知らせる（ここで読み上げると二重になる） */>
            {groups.map((g) => (
              <button
                type="button"
                key={g.label}
                onClick={() => jumpTo(g.label)}
                aria-label={`${g.label} ${g.count}件。押すと次の枠へ移動`}
                className={`inline-flex h-[44px] items-center rounded-full border border-[var(--cn-alert-line)] px-3.5 text-[14px] font-bold ${
                  g.level === "unassigned" ? "bg-[var(--cn-unassigned-bg)] text-[var(--cn-unassigned-ink)]" : "bg-[var(--cn-short-bg)] text-[var(--cn-short-ink)]"
                }`}
              >
                {g.label} {g.count}件 →
              </button>
            ))}
            {groups.length === 0 && <span className="text-[14px] text-[var(--cn-muted)]">すべての枠に担当が付いています</span>}
            <button
              type="button"
              aria-expanded={noteOpen}
              aria-label="この数字について"
              onClick={() => setNoteOpen((v) => !v)}
              className="inline-flex h-[44px] w-[44px] items-center justify-center rounded-full text-[16px] text-[var(--cn-muted)] hover:bg-white"
            >
              ⓘ
            </button>
            {noteOpen && <span className="text-[14px] text-[var(--cn-ink-soft)]">決めた人数にあと何人足りないか、です。ケアができていない数ではありません。</span>}
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
        {lastUndo && (
          <button
            type="button"
            onClick={async () => {
              const done = await engine?.undo();
              setToast(done ? `戻しました（${done.label}）` : null);
            }}
            className="inline-flex h-[44px] items-center gap-2 rounded-lg border border-[var(--cn-card-line)] bg-white px-4 text-[14px]"
          >
            元に戻す<span className="text-[13px] text-[var(--cn-muted)]">（{lastUndo.label}）</span>
          </button>
        )}
        {hasTasks && <BoardMenu state={state} engine={engine} date={date} dateShort={`${Number(date.slice(5, 7))}/${Number(date.slice(8))}`} onPrint={printSheet} onNotice={showNotice} />}
        </div>
      </div>

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

      {/* 本体 */}
      <BoardDnd engine={engine} onNotice={showNotice}>
      <main className="flex min-h-0 flex-1 gap-4 px-5 pb-5">
        <section aria-label="時間割" className="relative min-w-0 flex-1 overflow-hidden rounded-xl border border-[var(--cn-border)] bg-white">
          {/* 右の列がスクロールの先にあるとき（1280 幅など）の手掛かり。時間割の右上に重ねる */}
          {overflowX && hasTasks && view === "group" && (
            <div className="pointer-events-none absolute right-2 top-2.5 z-30 rounded bg-white/95 px-2 py-1 text-[14px] font-bold text-[var(--cn-ink-soft)] shadow" role="note">
              → 右に続き（横にスクロール）
            </div>
          )}
          <h2 id="board-title" tabIndex={-1} className="sr-only">
            {weekdayLabel(date)}の時間割
          </h2>
          {!ready ? (
            <div className="p-6 text-[var(--cn-muted)]">読み込んでいます…</div>
          ) : !hasTasks ? (
            <MorningBand state={state} date={date} />
          ) : view === "staff" ? (
            <StaffView state={state} date={date} now={now} onOpen={openDetail} />
          ) : (
            <div ref={scroller} className="h-full overflow-auto" data-testid="board-scroller">
              {/* 列見出し */}
              <div
                className="sticky top-0 z-20 grid border-b border-[var(--cn-border)] bg-white"
                style={{ gridTemplateColumns: colTemplate }}
              >
                <div className="sticky left-0 z-10 bg-white px-2 py-2.5 text-[13px] text-[var(--cn-muted)]">時刻</div>

                {columns.map((c) => (
                  <h2 key={c.id} className="border-l border-[var(--cn-grid)] px-3 py-2.5 font-bold">
                    <span>{c.name}</span> {c.sub && <span className="text-[14px] font-normal text-[var(--cn-muted)]">{c.sub}</span>}
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
                  <div key={c.id} className="relative border-l border-[var(--cn-grid)]">
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
                        <DropZone key={task.id} id={`task:${task.id}`} data={{ kind: "task", taskId: task.id }} className="absolute p-[3px]" style={{ top, height, left: `${left}%`, width: `${width}%` }}>
                          <TaskCard state={state} task={task} variant={rail ? "rail" : height < 84 ? "mini" : height < 150 ? "compact" : "normal"} onOpen={openDetail} onAdd={openAssign} />
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
                  <div aria-hidden="true" className="pointer-events-none absolute left-0 right-0 z-10" style={{ top: (now! - VIEW_START) * PX_PER_MIN }}>
                    <div className="absolute left-1 -translate-y-1/2 rounded bg-[var(--cn-now)] px-1.5 text-[13px] font-bold text-white">{fmtMin(now!)}</div>
                    <div className="ml-16 border-t-2 border-[var(--cn-now)]" />
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        {/* 右パレット（職員表示では行が職員なので出さない） */}
        {hasTasks && view === "group" && (
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
      {panel?.mode === "detail" && <TaskDetail key={panel.taskId} state={state} engine={engine} taskId={panel.taskId} onClose={closePanel} onAdd={openAssign} />}
      {panel?.mode === "assign" && <AssignPanel key={panel.taskId} state={state} engine={engine} taskId={panel.taskId} onClose={closePanel} onDetail={openDetail} />}
      <div id="board-toast" role="status" aria-live="polite" className="pointer-events-none fixed bottom-5 left-1/2 z-40 -translate-x-1/2">
        {notice && !toast && (
          <div className="pointer-events-auto rounded-[10px] bg-[var(--cn-ink)] px-4 py-3 text-[15px] text-white shadow-lg">{notice}</div>
        )}
        {toast && (
          <div className="pointer-events-auto flex items-center gap-3 rounded-[10px] bg-[var(--cn-ink)] px-4 py-3 text-[15px] text-white shadow-lg">
            <span>{toast}</span>
            <button
              type="button"
              onClick={() => {
                setToast(null);
                engine?.undo();
              }}
              className="h-[44px] rounded-md border border-white/40 px-3 text-[14px] font-bold"
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
