"use client";

import { useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { useAppState, useNowMinutes } from "@/store/react";
import { SAMPLE_DATE } from "@/store/sample";
import { boardColumns, paletteRows } from "@/domain/layout";
import { shortageGroups } from "@/domain/checks";
import { fmtMin, fmtRange } from "@/domain/time";
import { updatedAtLabel } from "@/domain/display";
import { TaskCard } from "./TaskCard";

/** 1分あたりの高さ(px)。1時間=180px。30分の業務でも2行（名前／担当・バッジ・＋44px）が入る */
const PX_PER_MIN = 3;
/** レール（見守りなど長い継続業務の帯）の幅 */
const RAIL_WIDTH = 28;
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
  const now = useNowMinutes();
  const scroller = useRef<HTMLDivElement>(null);

  const columns = useMemo(() => (ready ? boardColumns(state, date) : []), [state, date, ready]);
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

  const hours: number[] = [];
  for (let m = VIEW_START; m < VIEW_END; m += 60) hours.push(m);
  const nowInView = now !== null && now >= VIEW_START && now < VIEW_END;

  return (
    <div className="flex h-screen flex-col">
      {/* 上部バー（1段） */}
      <header className="flex h-14 shrink-0 items-center gap-5 border-b border-[var(--cn-border)] bg-white px-5">
        <div className="flex items-center gap-2.5">
          <span aria-hidden="true" className="inline-block h-7 w-7 rounded-lg bg-[var(--cn-accent)]" />
          <span className="text-[18px] font-bold">ケアナビ</span>
          <span className="text-[14px] text-[var(--cn-muted)]">{state.facility?.name ?? ""}</span>
        </div>
        <nav aria-label="主な画面" className="flex gap-1">
          <Link href="/board" aria-current="page" className="rounded-lg bg-[var(--cn-accent-soft)] px-3.5 py-2.5 font-bold text-[var(--cn-accent)]">
            ボード
          </Link>
          <Link href="/review" className="rounded-lg px-3.5 py-2.5 text-[var(--cn-ink-soft)]">
            業務の見直し
          </Link>
          <Link href="/setup" className="rounded-lg px-3.5 py-2.5 text-[var(--cn-ink-soft)]">
            設定
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-4">
          <span className="text-[16px] font-bold">{weekdayLabel(date)}</span>
          {updated && <span className="text-[14px] text-[var(--cn-muted)]">{updated}</span>}
        </div>
      </header>

      {/* ツールバー（1段） */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 px-5 py-2.5">
        <div role="group" aria-label="横軸" className="inline-flex overflow-hidden rounded-lg border border-[var(--cn-card-line)] bg-white">
          <button type="button" aria-pressed="true" className="h-[44px] bg-[var(--cn-ink)] px-4 text-[14px] font-bold text-white">
            グループ
          </button>
          <button type="button" aria-pressed="false" className="h-[44px] px-4 text-[14px] text-[var(--cn-ink-soft)]">
            職員
          </button>
        </div>
        {hasTasks && (
          <div className="flex items-center gap-2" aria-live="polite">
            {groups.map((g) => (
              <span
                key={g.label}
                className={`inline-flex h-[44px] items-center rounded-full border border-[var(--cn-alert-line)] px-3.5 text-[14px] font-bold ${
                  g.level === "unassigned" ? "bg-[var(--cn-unassigned-bg)] text-[var(--cn-unassigned-ink)]" : "bg-[var(--cn-short-bg)] text-[var(--cn-short-ink)]"
                }`}
              >
                {g.label} {g.count}件
              </span>
            ))}
            {groups.length === 0 && <span className="text-[14px] text-[var(--cn-muted)]">すべての枠に担当が付いています</span>}
            <span className="text-[13px] text-[var(--cn-muted)]">予定の担当枠の差分です（ケアの未実施ではありません）</span>
          </div>
        )}
      </div>

      {/* 本体 */}
      <main className="flex min-h-0 flex-1 gap-4 px-5 pb-5">
        <section aria-label="時間割" className="min-w-0 flex-1 overflow-hidden rounded-xl border border-[var(--cn-border)] bg-white">
          {!ready ? (
            <div className="p-6 text-[var(--cn-muted)]">読み込んでいます…</div>
          ) : !hasTasks ? (
            <div className="flex flex-col items-start gap-3 p-6">
              <p className="text-[16px]">この日の時間割はまだありません。</p>
              <p className="text-[14px] text-[var(--cn-muted)]">出勤者に番を付けて、業務表から作ります。</p>
            </div>
          ) : (
            <div ref={scroller} className="h-full overflow-auto" data-testid="board-scroller">
              {/* 列見出し */}
              <div
                className="sticky top-0 z-20 grid border-b border-[var(--cn-border)] bg-white"
                style={{ gridTemplateColumns: `64px repeat(${columns.length}, minmax(300px, 1fr))` }}
              >
                <div className="px-2 py-2.5 text-[13px] text-[var(--cn-muted)]">時刻</div>
                {columns.map((c) => (
                  <div key={c.id} className="border-l border-[var(--cn-grid)] px-3 py-2.5 font-bold">
                    <span>{c.name}</span> <span className="text-[13px] font-normal text-[var(--cn-muted)]">{c.sub}</span>
                  </div>
                ))}
              </div>
              {/* 時間割 */}
              <div
                className="relative grid"
                style={{
                  gridTemplateColumns: `64px repeat(${columns.length}, minmax(300px, 1fr))`,
                  height: (VIEW_END - VIEW_START) * PX_PER_MIN,
                  backgroundImage: "linear-gradient(var(--cn-grid) 1px, transparent 1px)",
                  backgroundSize: `100% ${60 * PX_PER_MIN}px`,
                }}
              >
                <div className="relative text-[13px] text-[var(--cn-muted)]">
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
                      const height = Math.max(52, (task.endMin - task.startMin) * PX_PER_MIN);
                      // レールは左 RAIL_WIDTH%、残りの業務はその右の幅を段数で割る
                      const areaLeft = rail ? 0 : c.hasRail ? RAIL_WIDTH : 0;
                      const areaWidth = rail ? RAIL_WIDTH : 100 - areaLeft;
                      const left = areaLeft + (areaWidth * lane) / lanes;
                      const width = areaWidth / lanes;
                      return (
                        <div key={task.id} className="absolute p-[3px]" style={{ top, height, left: `${left}%`, width: `${width}%` }}>
                          <TaskCard state={state} task={task} variant={rail ? "rail" : height < 70 ? "compact" : "normal"} />
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
        <aside aria-label="きょうの出勤者" className="flex w-[300px] shrink-0 flex-col gap-3 overflow-auto">
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
            <div className="rounded-xl border border-[var(--cn-border)] bg-white p-3.5">
              <div className="font-bold">休み</div>
              <ul className="mt-2 flex flex-col gap-1.5">
                {palette.off.map((r) => (
                  <li key={r.staffId} className="rounded-[10px] bg-[var(--cn-ground)] px-3 py-2 text-[14px] text-[var(--cn-ink-soft)]">
                    <span className="font-bold">{r.surname}</span> {r.slotName}
                    {r.unfilledSlotTasks > 0 && <span className="block text-[13px]">この人の番の枠 {r.unfilledSlotTasks}件が担当未定</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}
