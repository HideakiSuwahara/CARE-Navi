"use client";

import { useEffect, useMemo, useRef } from "react";
import { layoutColumn, staffViewRows, unfilledTasks, watchLines, type StaffViewRow } from "@/domain/layout";
import { tasksForDate } from "@/domain/checks";
import { fmtMin, fmtRange } from "@/domain/time";
import type { State } from "@/domain/types";

/**
 * ボードの職員表示（横軸＝職員）。印刷すると分担表（A4 横、日中と夜間の 2 枚）。docs/screens.md §1・§6
 * - 縦＝職員（名字・番・勤務時間）、横＝時間。担当を帯で描く。
 * - 勤務外は斜線。休憩は点線の帯。重なりは二重枠と「重なり」の文字。
 * - 最下段に見守りのつながり（空きは「13:00〜 担当未定」）。
 * - 件数・予定時間は出さない（決定記録 0003 §4）。
 * 罫線・斜線は印刷でも消えないよう、要素の枠線で描くか print-color-adjust を付ける。
 */

/** 画面の表示範囲: 06:00 → 翌 06:00 */
const DAY_START = 6 * 60;
const DAY_END = 30 * 60;
/** 画面では 1分=3px（1時間=180px。グループ表示と同じ）。印刷は紙の幅に合わせて縮める */
const PX_PER_MIN = 3;
const NAME_COL = 168;
/** 帯1段の高さ。1段で 46px（タップ領域 44px 以上） */
const LANE_H = 48;
/** 短い業務も画面ではこの幅（分）を占める（15分でも 45px → 押せる幅） */
const MIN_VISUAL_MIN = 15;

const EXACT: React.CSSProperties = { printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" };
const HATCH: React.CSSProperties = {
  ...EXACT,
  backgroundImage: "repeating-linear-gradient(135deg, rgba(138,143,148,0.55) 0 1.5px, transparent 1.5px 9px)",
};

type Range = { start: number; end: number };

function scale({ start, end }: Range) {
  const span = end - start;
  const clamp = (m: number) => Math.min(Math.max(m, start), end);
  return {
    span,
    pct: (m: number) => `${((clamp(m) - start) / span) * 100}%`,
    widthPct: (s: number, e: number) => `${((clamp(e) - clamp(s)) / span) * 100}%`,
    inView: (s: number, e: number) => e > start && s < end,
  };
}

/** 「10:00から10:30」（読み上げ用。「–」は読み飛ばされることがある） */
const spoken = (s: number, e: number) => `${fmtMin(s)}から${fmtMin(e)}`;

export function StaffView({
  state,
  date,
  now,
  print = false,
  range = { start: DAY_START, end: DAY_END },
  onOpen,
}: {
  state: State;
  date: string;
  now: number | null;
  /** 印刷用（分担表）。紙の幅いっぱいに描き、ボタンにしない */
  print?: boolean;
  range?: Range;
  onOpen?: (taskId: string) => void;
}) {
  const allRows = useMemo(() => staffViewRows(state, date), [state, date]);
  const watch = useMemo(() => watchLines(state, date), [state, date]);
  const sc = scale(range);
  // 印刷では、その範囲に勤務がある人だけを並べる
  const rows = print ? allRows.filter((r) => sc.inView(r.startMin, r.endMin)) : allRows;
  const watchInView = watch
    .map((l) => ({ ...l, segments: l.segments.filter((s) => sc.inView(s.task.startMin, s.task.endMin)) }))
    .filter((l) => l.segments.length > 0);
  const scroller = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);

  // 開いたとき、現在時刻の1時間前へ寄せる
  useEffect(() => {
    if (print || now === null || scrolled.current || !scroller.current) return;
    scroller.current.scrollLeft = Math.max(0, (now - 60 - range.start) * PX_PER_MIN);
    scrolled.current = true;
  }, [now, print, range.start]);

  const hours: number[] = [];
  for (let m = range.start; m < range.end; m += 60) hours.push(m);
  const nowInView = !print && now !== null && now >= range.start && now < range.end;
  const timelineStyle: React.CSSProperties = print ? { flex: 1 } : { width: `${sc.span * PX_PER_MIN}px` };
  const stickyName = print ? "" : "sticky left-0 z-10 bg-white";

  // 1時間ごとの縦の罫（印刷で消えないよう、背景ではなく枠線の要素で描く）
  const gridLines = (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      {hours.map((m) => (
        <div key={m} className="absolute inset-y-0 border-l border-[#c9cac4]" style={{ left: sc.pct(m) }} />
      ))}
    </div>
  );

  return (
    <div ref={scroller} className={print ? "" : "h-full overflow-auto"} data-testid={print ? undefined : "staff-view"}>
      <div className="relative" style={{ minWidth: print ? undefined : NAME_COL + sc.span * PX_PER_MIN }}>
        {/* 時刻の見出し */}
        <div className={`flex border-b border-[var(--cn-control-line)] bg-white ${print ? "" : "sticky top-0 z-20"}`}>
          <div className={`shrink-0 px-2 py-2 text-[13px] text-[var(--cn-muted)] ${stickyName}`} style={{ width: NAME_COL }}>
            職員
          </div>
          <div className="relative h-[36px]" style={timelineStyle}>
            {hours.map((m) => (
              <span key={m} className="absolute top-2 pl-1 text-[13px] text-[var(--cn-muted)]" style={{ left: sc.pct(m) }}>
                {fmtMin(m)}
              </span>
            ))}
          </div>
        </div>

        <ul aria-label="職員ごとの担当">
          {rows.map((r) => (
            <StaffRowView key={r.staffId} row={r} print={print} range={range} timelineStyle={timelineStyle} stickyName={stickyName} gridLines={gridLines} onOpen={onOpen} />
          ))}
        </ul>

        {/* 見守りのつながり */}
        {watchInView.length > 0 && (
          <ul
            id={print ? undefined : "watch-lines"}
            tabIndex={print ? undefined : -1}
            aria-label="見守りのつながり"
            className="border-t-2 border-[var(--cn-control-line)]"
          >
            {watchInView.map((line) => (
              <li key={line.groupId} className="flex break-inside-avoid border-b border-[var(--cn-border)]">
                <div className={`shrink-0 px-2 py-1.5 ${stickyName}`} style={{ width: NAME_COL }}>
                  <span className="font-bold">見守り</span> <span className="text-[13px] text-[var(--cn-muted)]">{line.name}</span>
                </div>
                <div className={`relative ${print ? "h-[40px]" : "h-[56px]"}`} style={timelineStyle}>
                  {gridLines}
                  {line.segments.map((seg) => {
                    // 担当あと n 人のときは、入っている人の名字も並べる
                    const who = [seg.surnames.join("・"), seg.label].filter(Boolean).join("・");
                    const cls = `absolute top-1 bottom-1 overflow-hidden rounded-md px-1 text-left leading-tight focus-visible:z-20 ${print ? "text-[12px]" : "text-[14px]"} ${
                      seg.label
                        ? `border-2 border-dashed border-[var(--cn-alert-line)] font-bold ${seg.surnames.length === 0 ? "bg-[var(--cn-unassigned-bg)] text-[var(--cn-unassigned-ink)]" : "bg-[var(--cn-short-bg)] text-[var(--cn-short-ink)]"}`
                        : "border border-[var(--cn-control-line)] bg-white"
                    }`;
                    const style = { ...EXACT, left: sc.pct(seg.task.startMin), width: sc.widthPct(seg.task.startMin, seg.task.endMin) };
                    const body = (
                      <>
                        <span className="block whitespace-nowrap">{fmtMin(seg.task.startMin)}〜</span>
                        <span className="block truncate">{who}</span>
                      </>
                    );
                    return print || !onOpen ? (
                      <div key={seg.task.id} className={cls} style={style}>
                        {body}
                      </div>
                    ) : (
                      <button
                        key={seg.task.id}
                        type="button"
                        aria-label={`見守り ${line.name}、${spoken(seg.task.startMin, seg.task.endMin)}、${who}`}
                        title={`${fmtRange(seg.task.startMin, seg.task.endMin)} ${who}`}
                        onClick={() => onOpen(seg.task.id)}
                        className={cls}
                        style={style}
                      >
                        {body}
                      </button>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        )}

        {nowInView && (
          <div aria-hidden="true" className="pointer-events-none absolute bottom-0 top-0 z-10" style={{ left: NAME_COL + (now! - range.start) * PX_PER_MIN }}>
            <div className="h-full border-l-2 border-[var(--cn-now)]" />
            <div className="absolute top-[40px] -translate-x-1/2 rounded bg-[var(--cn-now)] px-1.5 text-[13px] font-bold text-white">{fmtMin(now!)}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function StaffRowView({
  row,
  print,
  range,
  timelineStyle,
  stickyName,
  gridLines,
  onOpen,
}: {
  row: StaffViewRow;
  print: boolean;
  range: Range;
  timelineStyle: React.CSSProperties;
  stickyName: string;
  gridLines: React.ReactNode;
  onOpen?: (taskId: string) => void;
}) {
  const sc = scale(range);
  // 範囲にかかる帯だけを描く。重なる帯は上下に段を分けて、どちらも読めるようにする
  const laid = layoutColumn(
    row.bars.map((b) => b.task).filter((t) => sc.inView(t.startMin, t.endMin)),
    print ? 0 : MIN_VISUAL_MIN,
  );
  const lanes = Math.max(1, ...laid.map((c) => c.lanes));
  const barOf = new Map(row.bars.map((b) => [b.task.id, b]));
  const laneH = print ? 36 : LANE_H;
  const height = Math.max(print ? 40 : 56, lanes * laneH + 6);
  return (
    <li className="flex break-inside-avoid border-b border-[var(--cn-border)]" data-staff-row={row.surname}>
      <div className={`shrink-0 px-2 ${print ? "py-0.5 leading-tight" : "py-1.5"} ${stickyName}`} style={{ width: NAME_COL }}>
        <div className="flex items-center gap-1.5">
          <span className="font-bold">{row.surname}</span>
          {row.firstTimer && <span className="rounded border border-[var(--cn-control-line)] px-1 text-[13px]">初回</span>}
        </div>
        <div className="text-[13px] text-[var(--cn-muted)]">
          {row.slotName} {fmtRange(row.startMin, row.endMin)}
        </div>
      </div>
      <div className="relative" style={{ ...timelineStyle, height }}>
        {gridLines}
        {/* 勤務外は斜線 */}
        {row.startMin > range.start && <div aria-hidden="true" className="absolute inset-y-0 left-0" style={{ ...HATCH, width: sc.widthPct(range.start, row.startMin) }} />}
        {row.endMin < range.end && <div aria-hidden="true" className="absolute inset-y-0" style={{ ...HATCH, left: sc.pct(row.endMin), right: 0 }} />}
        {laid.map(({ task, lane, lanes: n }) => {
          const bar = barOf.get(task.id)!;
          const top = 3 + (lane * (height - 6)) / n;
          const h = (height - 6) / n - 2;
          const visualEnd = print ? task.endMin : Math.max(task.endMin, task.startMin + MIN_VISUAL_MIN);
          const cls = `absolute overflow-hidden rounded-md px-1 text-left leading-[1.15] focus-visible:z-20 ${print ? "text-[12px]" : "text-[15px]"} ${
            bar.isBreak
              ? "border-2 border-dashed border-[var(--cn-break-ink)] bg-[var(--cn-break-bg)]"
              : bar.overlap
                ? "border-4 border-double border-[var(--cn-alert-line)] bg-white"
                : "border border-[var(--cn-control-line)] bg-white"
          }`;
          const style = { ...EXACT, left: sc.pct(task.startMin), width: sc.widthPct(task.startMin, visualEnd), top, height: h };
          // 2行まで。切れるときは「…」
          const body = (
            <span className="line-clamp-2 break-words">
              {bar.overlap && <span className="mr-1 font-bold text-[var(--cn-unassigned-ink)]">重なり</span>}
              {bar.label}
            </span>
          );
          return print || !onOpen ? (
            <div key={task.id} className={cls} style={style}>
              {body}
            </div>
          ) : (
            <button
              key={task.id}
              type="button"
              aria-label={`${bar.overlap ? "重なり " : ""}${bar.fullLabel}、${row.surname}さん、${spoken(task.startMin, task.endMin)}`}
              title={`${fmtRange(task.startMin, task.endMin)} ${bar.fullLabel}`}
              onClick={() => onOpen(task.id)}
              className={cls}
              style={style}
            >
              {body}
            </button>
          );
        })}
      </div>
    </li>
  );
}

/** 印刷のページ: 日中 6:00–18:00 と 夜間 18:00–翌6:00（24時間を1枚に詰めると文字が読めない） */
const PRINT_PAGES: { title: string; range: Range }[] = [
  { title: "日中 6:00–18:00", range: { start: 6 * 60, end: 18 * 60 } },
  { title: "夜間 18:00–翌6:00", range: { start: 18 * 60, end: 30 * 60 } },
];

/** 分担表（印刷用）。A4 横。日付・施設名・印刷時刻、最後に担当未定・担当あと n 人の枠の一覧 */
export function StaffSheetPrint({ state, date, dateLabel, printedAt }: { state: State; date: string; dateLabel: string; printedAt: string }) {
  const unfilled = useMemo(() => unfilledTasks(state, date), [state, date]);
  // 夜間のページは、翌 6:00 より後に終わる業務（夜勤明け）があればそこまで伸ばす（ボードと同じ）
  const nightEnd = useMemo(() => {
    const maxEnd = Math.max(30 * 60, ...tasksForDate(state, date).map((t) => t.endMin));
    return Math.ceil(maxEnd / 60) * 60;
  }, [state, date]);
  const pages = PRINT_PAGES.map((p) => (p.range.start === 18 * 60 ? { title: `夜間 18:00–${fmtMin(nightEnd)}`, range: { start: 18 * 60, end: nightEnd } } : p));
  return (
    <div className="hidden text-[12px] print:block" data-testid="staff-sheet-print">
      <style>{"@media print { @page { size: A4 landscape; margin: 8mm; } .cn-staff-page + .cn-staff-page { break-before: page; } }"}</style>
      {pages.map((p, i) => (
        <section key={p.title} className="cn-staff-page" aria-label={`分担表 ${p.title}`}>
          <div className="mb-2 flex items-baseline gap-4">
            <h2 className="text-[16px] font-bold">
              分担表 {dateLabel} {p.title}
            </h2>
            <span>{state.facility?.name ?? ""}</span>
            <span className="ml-auto">印刷 {printedAt}</span>
          </div>
          <StaffView state={state} date={date} now={null} print range={p.range} />
          {i === pages.length - 1 && (
            <section aria-label="担当未定・担当あと n 人の枠" className="mt-2 break-inside-avoid">
              <h3 className="font-bold">
                担当未定・担当あと n 人の枠 <span className="font-normal">（決めた人数にあと何人足りないか、です。ケアができていない数ではありません。）</span>
              </h3>
              {unfilled.length === 0 ? (
                <p>ありません。</p>
              ) : (
                <ul className="columns-3">
                  {unfilled.map((u) => (
                    <li key={u.task.id}>
                      {fmtRange(u.task.startMin, u.task.endMin)} {u.label} — {u.status}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </section>
      ))}
    </div>
  );
}
