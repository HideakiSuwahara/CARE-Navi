"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { TopBar } from "@/components/TopBar";
import { useAppState, useEngine, useNowMinutes } from "@/store/react";
import { SAMPLE_DATE } from "@/store/sample";
import { boardColumns, paletteRows } from "@/domain/layout";
import { shortageGroups } from "@/domain/checks";
import { fmtMin, fmtRange } from "@/domain/time";
import { updatedAtLabel } from "@/domain/display";
import { TaskCard } from "./TaskCard";
import { MorningBand } from "./MorningBand";
import { TaskDetail } from "./TaskDetail";

/** 1分あたりの高さ(px)。1時間=180px。30分の業務でも2行（名前／担当・バッジ・＋44px）が入る */
const PX_PER_MIN = 3;
/** レール（見守りなど長い継続業務の帯）の幅 */
const RAIL_WIDTH = 28;
/** 短い業務も画面上はこの長さ（分）を占めるものとして並べる。20分 = 60px（1段のカードに ＋ が収まる） */
const MIN_VISUAL_MIN = 20;
/** 横に並ぶカード1枚あたりの最小幅(px) */
const MIN_CARD_WIDTH = 130;
/** 表示する範囲: 06:00 → 翌 06:00 */
const VIEW_START = 6 * 60;
const VIEW_END = 30 * 60;

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
  const forceBoard = false;
  const scroller = useRef<HTMLDivElement>(null);

  const columns = useMemo(() => (ready ? boardColumns(state, date, MIN_VISUAL_MIN) : []), [state, date, ready]);
  // 列の最小幅: 同じ時刻に横に並ぶ枚数に合わせて広げる（カードを細くしすぎない。足りなければ横にスクロール）
  const colTemplate = `64px ${columns
    .map((c) => {
      const min = Math.max(260, Math.ceil((c.maxLanes * MIN_CARD_WIDTH) / (c.hasRail ? 1 - RAIL_WIDTH / 100 : 1)));
      // 余った幅も必要な幅の比で分ける
      return `minmax(${min}px, ${min}fr)`;
    })
    .join(" ")}`;
  const palette = useMemo(() => (ready ? paletteRows(state, date) : { working: [], off: [] }), [state, date, ready]);
  const groups = useMemo(() => (ready ? shortageGroups(state, date) : []), [state, date, ready]);
  const updated = updatedAtLabel(state.days[date]?.updatedAt);
  const hasTasks = columns.some((c) => c.cards.length > 0);

  // 開いたとき、現在時刻の1時間前へ寄せる（時間の切替ボタンは置かない）
  const scrolled = useRef(false);
  useEffect(() => {
    if (!ready || now === null || scrolled.current || !scroller.current) return;
    scroller.current.scrollTop = Math.max(0, (now - 60 - VIEW_START) * PX_PER_MIN);
    scrolled.current = true;
  }, [ready, now]);

  // 見出しの「担当未定 n件」を押すと、該当するカードへ順に移動する（押すたびに次へ）
  const jumpIndex = useRef<Record<string, number>>({});
  const jumpTo = (label: string) => {
    const root = scroller.current;
    if (!root) return;
    const cards = Array.from(root.querySelectorAll<HTMLElement>(`[data-task-id][data-badge="${label}"]`)).sort(
      (a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top || a.getBoundingClientRect().left - b.getBoundingClientRect().left,
    );
    if (cards.length === 0) return;
    const i = (jumpIndex.current[label] ?? -1) + 1;
    jumpIndex.current[label] = i % cards.length;
    const el = cards[i % cards.length];
    el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    el.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    el.animate([{ boxShadow: "0 0 0 4px var(--cn-alert-line)" }, { boxShadow: "0 0 0 0 transparent" }], { duration: 1200 });
  };

  // 操作のあとのお知らせ（トースト）。8秒で消えるが「元に戻す」はツールバーに残る
  const [toast, setToast] = useState<string | null>(null);
  // 業務の詳細（カードの名前を押すと開く）
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const openDetail = (id: string) => {
    openerRef.current = document.activeElement as HTMLElement | null;
    setOpenTaskId(id);
  };
  const closeDetail = useCallback(() => {
    setOpenTaskId(null);
    openerRef.current?.focus();
  }, []);
  const lastLabel = lastUndo ? `${lastUndo.batchId}` : "";
  useEffect(() => {
    if (!lastUndo) return;
    setToast(lastUndo.label);
    const id = window.setTimeout(() => setToast(null), 8000);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastLabel]);

  const hours: number[] = [];
  for (let m = VIEW_START; m < VIEW_END; m += 60) hours.push(m);
  const nowInView = now !== null && now >= VIEW_START && now < VIEW_END;

  return (
    <>
      {/* スマホ幅: ボード（表）は出さず、1文と1ボタン（docs/screens.md §1） */}
      {!forceBoard && (
        <div className="flex min-h-screen flex-col items-start gap-4 p-5 md:hidden">
          <p className="text-[17px] font-bold">ボードは PC・タブレット用の画面です。</p>
          <p className="text-[16px] text-[var(--cn-ink-soft)]">PC かタブレット（横向き）で開いてください。スマホ用の「自分の予定」は次の版で入ります。</p>
        </div>
      )}
    <div className={`${forceBoard ? "flex" : "hidden md:flex"} h-screen flex-col`}>
      <a href="#staff-palette" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-2">
        出勤者一覧へ移動
      </a>
      {/* 上部バー（1段） */}
      <TopBar current="board">
        <span className="text-[16px] font-bold">{weekdayLabel(date)}</span>
        {updated && <span className="text-[14px] text-[var(--cn-muted)]">{updated}</span>}
      </TopBar>

      {/* ツールバー（1段） */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 px-5 py-2.5">
        {hasTasks && (
          <div className="flex items-center gap-2" aria-live="polite">
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
            {noteOpen && <span className="text-[14px] text-[var(--cn-ink-soft)]">予定の担当枠の差分です。ケアをしていない人数ではありません。</span>}
          </div>
        )}
        {lastUndo && (
          <button
            type="button"
            onClick={() => engine?.undo()}
            className="ml-auto inline-flex h-[44px] items-center gap-2 rounded-lg border border-[var(--cn-card-line)] bg-white px-4 text-[14px]"
          >
            元に戻す<span className="text-[13px] text-[var(--cn-muted)]">（{lastUndo.label}）</span>
          </button>
        )}
      </div>

      {/* 本体 */}
      <main className="flex min-h-0 flex-1 gap-4 px-5 pb-5">
        <section aria-label="時間割" className="min-w-0 flex-1 overflow-hidden rounded-xl border border-[var(--cn-border)] bg-white">
          <h2 id="board-title" tabIndex={-1} className="sr-only">
            {weekdayLabel(date)}の時間割
          </h2>
          {!ready ? (
            <div className="p-6 text-[var(--cn-muted)]">読み込んでいます…</div>
          ) : !hasTasks ? (
            <MorningBand state={state} date={date} />
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
                    <span>{c.name}</span> {c.sub && <span className="text-[13px] font-normal text-[var(--cn-muted)]">{c.sub}</span>}
                  </h2>
                ))}
              </div>
              {/* 時間割 */}
              <div
                className="relative grid"
                style={{
                  gridTemplateColumns: colTemplate,
                  height: (VIEW_END - VIEW_START) * PX_PER_MIN,
                  backgroundImage: "linear-gradient(var(--cn-grid) 1px, transparent 1px)",
                  backgroundSize: `100% ${60 * PX_PER_MIN}px`,
                }}
              >
                <div className="sticky left-0 z-[5] bg-white text-[13px] text-[var(--cn-muted)]">
                  {hours.map((m) => (
                    <div key={m} className="absolute left-2" style={{ top: (m - VIEW_START) * PX_PER_MIN + 4 }}>
                      {fmtMin(m)}
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
                        <div key={task.id} className="absolute p-[3px]" style={{ top, height, left: `${left}%`, width: `${width}%` }}>
                          <TaskCard state={state} task={task} variant={rail ? "rail" : height < 80 ? "mini" : height < 150 ? "compact" : "normal"} onOpen={openDetail} onAdd={openDetail} />
                        </div>
                      );
                    })}
                  </div>
                ))}
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

        {/* 右パレット */}
        {hasTasks && (
        <aside id="staff-palette" aria-label="きょうの出勤者" className="flex w-[300px] shrink-0 flex-col gap-3 overflow-auto">
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
                    <button
                      type="button"
                      className={`flex min-h-[44px] w-full items-center gap-2.5 rounded-[10px] border px-3 py-2 text-left ${
                        later ? "border-[var(--cn-border)] bg-[var(--cn-ground)]" : "border-[var(--cn-card-line)] bg-white"
                      }`}
                      aria-label={`${r.surname} ${r.slotName} ${fmtRange(r.startMin, r.endMin)}${r.firstTimer ? " 初回" : ""}`}
                    >
                      <span className="shrink-0 font-bold">{r.surname}</span>
                      {r.firstTimer && <span className="shrink-0 rounded border border-[var(--cn-card-line)] bg-white px-1.5 text-[13px]">初回</span>}
                      <span className="min-w-0 truncate text-[13px] text-[var(--cn-muted)]">{r.slotName}</span>
                      <span className="ml-auto shrink-0 whitespace-nowrap text-[13px] text-[var(--cn-muted)]">
                        {later ? `${fmtMin(r.startMin)}から` : fmtRange(r.startMin, r.endMin)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
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
      {openTaskId && <TaskDetail state={state} taskId={openTaskId} onClose={closeDetail} />}
      <div role="status" aria-live="polite" className="pointer-events-none fixed bottom-5 left-1/2 z-40 -translate-x-1/2">
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
    </>
  );
}
