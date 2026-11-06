"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { tasksForDate } from "@/domain/checks";
import { freeGaps, leaderSchedule, myDay, type FreeGap, type MyItem } from "@/domain/myday";
import { fmtMin, fmtRange } from "@/domain/time";
import type { ID, State } from "@/domain/types";
import { contactName, HelpBar } from "./HelpBar";
import { SyncBadge } from "@/components/SyncBadge";
import { DONE_EVENT, DoneButton, DoneToast, doneHint, type DoneNotice } from "@/components/DoneButton";
import { useEngine, isSampleFacility } from "@/store/react";
import { LAST_TASK_KEY, meHref } from "./links";

/**
 * 自分の予定の本文。docs/screens.md §4
 * - 「いまの時間の予定」。なければ「最初の予定」（勤務前）または「つぎ」を同じ大きさで。
 * - 「きょうの流れ」: 時刻順。印の付いた行は「✓ 終わった」と薄く。時刻が過ぎただけの行は通常の濃さ、いまの位置に「● いまの時間」。最後に「退勤」。
 * - 充足バッジ・仕組みの言葉は出さない。持つのは「終わった」の印だけ。内容の記録はしない（決定記録 0010）。
 * - 初回の人には、お願いすること・お願いしないこと・物品を開いて出す（勤務中も）。
 */
export function MyDayView({
  state,
  date,
  me,
  now,
  onSwitch,
  missingTask = false,
  tabsBelow = false,
}: {
  state: State;
  date: string;
  me: ID;
  now: number;
  onSwitch: () => void;
  /** ?task= の予定が見つからなかった（変更・中止された） */
  missingTask?: boolean;
  /** 画面下に［自分｜全体］があるか（トーストをその上に出す） */
  tabsBelow?: boolean;
}) {
  const day = useMemo(() => myDay(state, date, me, now), [state, date, me, now]);
  const hasDay = useMemo(() => tasksForDate(state, date).length > 0, [state, date]);
  const titleRef = useRef<HTMLHeadingElement>(null);
  // 直前の操作（この画面では「終わった」の付け外し）を、トーストが消えたあとも戻せるように見出しの横に出す
  const engine = useEngine();
  const lastUndo = useSyncExternalStore(
    (cb) => (engine ? engine.subscribe(cb) : () => {}),
    // 自分の予定で戻せるのは、この日の「終わった」の印だけ（リーダーの操作をここから戻さない。ループ 19）
    () => engine?.lastUndoWhere((u) => Boolean(u.doneOnly) && Boolean(u.dates?.includes(date))) ?? null,
    () => null,
  );
  const undoLast = async () => {
    if (!engine) return;
    if (!lastUndo) return;
    const done = await engine.undo(lastUndo.batchId);
    if (!done) return;
    window.dispatchEvent(new CustomEvent<DoneNotice>(DONE_EVENT, { detail: { label: `元に戻しました（取り消した操作: ${done.label}）`, batchId: null, taskId: "" } }));
    titleRef.current?.focus({ preventScroll: true });
  };

  // 開いたとき: 業務詳細から戻ったなら、押した行へフォーカスを返す。そうでなければ見出しへ（名前を選んだあとに画面が変わったと伝わる）
  useEffect(() => {
    let last: string | null = null;
    try {
      last = window.sessionStorage.getItem(LAST_TASK_KEY);
      window.sessionStorage.removeItem(LAST_TASK_KEY);
    } catch {
      // 保存できない端末では見出しへ
    }
    const row = last ? document.querySelector<HTMLElement>(`[data-flow-task="${CSS.escape(last)}"]`) : null;
    if (row) row.focus();
    else titleRef.current?.focus({ preventScroll: true });
  }, []);
  const [printedAt, setPrintedAt] = useState("");
  const sampleRef = useRef(isSampleFacility(state));
  sampleRef.current = isSampleFacility(state);
  const nowRef = useRef(now);
  nowRef.current = now;

  useEffect(() => {
    const stamp = () => {
      // サンプル施設はサンプルの日と時計で（印刷の日時が 11/3 の一日と食い違わないように。ループ 19）
      if (sampleRef.current) {
        const [, mm, dd] = date.split("-").map(Number);
        setPrintedAt(`${mm}/${dd} ${fmtMin(nowRef.current)}`);
        return;
      }
      const d = new Date();
      setPrintedAt(`${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`);
    };
    stamp();
    window.addEventListener("beforeprint", stamp);
    return () => window.removeEventListener("beforeprint", stamp);
  }, [date]);


  if (!day) return null;
  const [, m, d] = date.split("-").map(Number);
  const wd = "日月火水木金土"[new Date(Date.UTC(Number(date.slice(0, 4)), m - 1, d)).getUTCDay()];
  const firstTimer = day.entry.firstTimer;
  const inShift = now >= day.entry.startMin && now < day.entry.endMin;
  // 勤務中で、いまの時間に予定がない（つぎ まで空いている）
  const gap = inShift && day.focusMode === "next";
  const heading = day.focusMode === "now" ? "いまの時間の予定" : day.focusMode === "first" ? "最初の予定" : "つぎ";
  const schedule = leaderSchedule(state, date, day.entry.startMin, day.entry.endMin);

  return (
    <main className="mx-auto min-h-screen max-w-[480px] bg-[var(--cn-ground)] pb-[88px] text-[16px] print:max-w-none print:bg-white print:pb-0">
      <style>{"@media print { @page { size: A4 portrait; margin: 10mm; } } html { scroll-padding-top: 76px; }"}</style>
      <header className="flex items-start gap-2 bg-white px-4 pb-3 pt-4">
        <div className="min-w-0 flex-1">
          <h1 ref={titleRef} tabIndex={-1} className="text-[20px] font-bold outline-none">
            {day.staff.surname} さんの予定
          </h1>
          <p className="text-[16px] text-[var(--cn-ink-soft)]">
            {m}/{d}（{wd}）{day.slotName} {fmtRange(day.entry.startMin, day.entry.endMin)}
            <span className="hidden print:inline"> ・ 印刷 {printedAt}</span>
          </p>
          <button
            type="button"
            onClick={onSwitch}
            className="cn-noprint mt-2 inline-flex h-[44px] items-center rounded-lg border border-[var(--cn-control-line)] px-3 text-[16px]"
          >
            自分ではない（名前を選び直す）
          </button>
        </div>
        <div className="cn-noprint flex shrink-0 flex-col items-end gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex h-[44px] items-center rounded-lg border border-[var(--cn-control-line)] bg-white px-3 text-[16px]"
          >
            印刷
          </button>
          {lastUndo && (
            <button type="button" onClick={undoLast} aria-label={`元に戻す（${lastUndo.label}）`} className="inline-flex h-[44px] items-center rounded-lg border border-[var(--cn-control-line)] bg-white px-3 text-[16px] font-bold text-[var(--cn-accent)]">
              元に戻す
            </button>
          )}
        </div>
      </header>

      <div className="cn-noprint flex justify-end bg-white px-4 pb-1 empty:hidden">
        <SyncBadge offlineOnly />
      </div>
      <HelpBar state={state} date={date} me={me} now={now} />

      {/* 印刷: 相談先を時間帯ごとに（10:00 に刷っても夕方の相談先が分かるように）。1枚目の上に置く */}
      {schedule.length > 0 && (
        <section className="hidden px-4 pt-2 print:block">
          <h2 className="font-bold">困ったら</h2>
          <p>{schedule.map((x) => `${fmtRange(x.startMin, x.endMin)} ${contactName(x.contact)}`).join(" ／ ")}</p>
        </section>
      )}

      <div className="flex flex-col gap-4 px-4 pt-4">
        {missingTask && (
          <p role="status" className="cn-noprint rounded-xl border-2 border-[var(--cn-alert-line)] bg-white p-3">
            開こうとした予定は見つかりませんでした（変更か中止になった可能性があります）。いまの予定は下のとおりです。
          </p>
        )}

        {!hasDay ? (
          <section className="cn-noprint rounded-xl bg-white p-4">
            <p>きょうの時間割はまだできていません。リーダーが作ると、ここに出ます。</p>
          </section>
        ) : day.focus.length > 0 ? (
          <section aria-labelledby="focus-title" className="cn-noprint">
            {gap && (
              <>
                <h2 className="mb-2 text-[18px] font-bold">いまの時間の予定</h2>
                <p className="mb-4 rounded-xl bg-white p-4">
                  いまの時間の予定はありません（{fmtMin(day.focus[0].task.startMin)} から {day.focus[0].title}）。迷ったら、上の「困ったら」の人へ。
                </p>
              </>
            )}
            <h2 id="focus-title" className="mb-2 text-[18px] font-bold">
              {heading}
            </h2>
            <div className="flex flex-col gap-2">
              {day.focus.map((i) => (
                <FocusCard key={i.task.id} item={i} open={firstTimer} now={now} />
              ))}
            </div>
            {day.upcoming && (
              <>
                <h2 className="mb-2 mt-4 text-[18px] font-bold">つぎ</h2>
                <FocusCard item={day.upcoming} open={firstTimer} now={now} upcoming />
              </>
            )}
          </section>
        ) : (
          <section className="cn-noprint rounded-xl bg-white p-4">
            <p>このあとの予定はありません。退勤は {fmtMin(day.entry.endMin)} です。</p>
          </section>
        )}

        <section aria-labelledby="flow-title">
          <h2 id="flow-title" className="mb-2 text-[18px] font-bold">
            きょうの流れ
          </h2>
          <ol className="flex flex-col overflow-hidden rounded-xl border border-[var(--cn-border)] bg-white print:border-[#767b80]">
            {flowWithNow(day.items, now, day.entry.startMin, day.entry.endMin, freeGaps(state, date, me, 30, now)).map((row) =>
              row.kind === "gap" ? (
                <li key={`gap-${row.gap.startMin}`} className="cn-noprint flex items-baseline gap-3 border-b border-dashed border-[var(--cn-grid)] px-4 py-3 text-[var(--cn-ink-soft)]">
                  <span className="w-[96px] shrink-0">
                    {fmtMin(row.gap.startMin)}
                    <span>–{fmtMin(row.gap.endMin)}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold">予定のない時間</span>
                    <span className="block text-[14px]">
                      {row.gap.helpable.length > 0
                        ? `手伝える仕事: ${row.gap.helpable.join("・")}。先にリーダーに声をかけてください`
                        : row.gap.night
                          ? "手が空いたら、いっしょの夜勤の人に声をかけてください"
                          : "手が空いたら、リーダーに声をかけてください"}
                    </span>
                  </span>
                </li>
              ) : row.kind === "now" ? (
                <li key="now" className="cn-noprint flex items-center gap-2 border-y-2 border-[var(--cn-now)] px-4 py-1.5 text-[16px] font-bold text-[var(--cn-now)]">
                  ● いまの時間 {fmtMin(now)}
                </li>
              ) : row.kind === "end" ? (
                <li key="end" className="flex items-baseline gap-3 px-4 py-3">
                  <span className="w-[96px] shrink-0 font-bold">{fmtMin(day.entry.endMin)}</span>
                  <span>退勤</span>
                </li>
              ) : (
                <FlowRow key={row.item.task.id} item={row.item} now={now} />
              ),
            )}
          </ol>
        </section>
      </div>
      <DoneToast raised={tabsBelow} />
    </main>
  );
}

type FlowRowData = { kind: "item"; item: MyItem } | { kind: "now" } | { kind: "end" } | { kind: "gap"; gap: FreeGap };

/** きょうの流れに「● いまの時間」を差し込む（勤務時間中だけ） */
function flowWithNow(items: MyItem[], now: number, start: number, end: number, gaps: FreeGap[] = []): FlowRowData[] {
  const rows: FlowRowData[] = [];
  const showNow = now >= start && now < end;
  let placed = false;
  // 予定のない時間（手が空いたら）を時刻の順に差し込む（決定記録 0021）
  const pending = [...gaps];
  const pushGapsBefore = (min: number) => {
    while (pending.length > 0 && pending[0].startMin < min) {
      // いまの線は時刻の順に（予定のない時間より前ならその前へ。中にあるならその行の後ろへ。ループ 20）
      if (showNow && !placed && pending[0].startMin > now) {
        rows.push({ kind: "now" });
        placed = true;
      }
      rows.push({ kind: "gap", gap: pending.shift()! });
    }
  };
  for (const item of items) {
    pushGapsBefore(item.task.startMin);
    if (showNow && !placed && item.task.startMin > now) {
      rows.push({ kind: "now" });
      placed = true;
    }
    rows.push({ kind: "item", item });
  }
  pushGapsBefore(Infinity);
  if (showNow && !placed) rows.push({ kind: "now" });
  rows.push({ kind: "end" });
  return rows;
}

function FlowRow({ item, now }: { item: MyItem; now: number }) {
  const t = item.task;
  // 「終わった」の印がある行は薄く。時刻が過ぎただけの行は通常の濃さのまま（決定記録 0010）
  return (
    // 「いま」の行はボタンを下の段に（業務名が 2〜3 字ずつ折れないように。ループ 19）
    // スマホ幅では「終わったら押す」のある行はすべてボタンを下の段に（過ぎた行も業務名が折れないように。ループ 20）
    <li className={`flex items-stretch break-inside-avoid border-b border-[var(--cn-grid)] last:border-b-0 print:border-b-[#9a9fa5] max-sm:flex-wrap ${item.current ? "flex-wrap bg-[var(--cn-accent-soft)]" : ""}`}>
      <Link
        href={meHref(t.id)}
        data-flow-task={t.id}
        className={`flex min-h-[52px] min-w-0 flex-1 items-baseline gap-3 px-4 py-3 print:min-h-0 print:py-1 print:text-[var(--cn-ink)] ${item.done ? "text-[var(--cn-muted)]" : ""}`}
      >
        <span className="w-[96px] shrink-0 font-bold">
          {fmtMin(t.startMin)}
          <span className="font-normal">–{fmtMin(t.endMin)}</span>
        </span>
        <span className="min-w-0 flex-1">
          {item.current && (
            <span className="mr-1 rounded bg-[var(--cn-accent)] px-1.5 text-[14px] font-bold text-white print:hidden">
              いま<span className="sr-only">の時間の予定: </span>
            </span>
          )}
          {item.past && !item.done && <span className="sr-only">（時刻を過ぎた予定）</span>}
          <span className={item.current ? "font-bold" : ""}>{item.title}</span>
          {/* 右に「✓ 終わった」のボタンが出る行では、行の中には画面では重ねて書かない（2 か所に出ないように。ボタンは印刷に出ないので、印刷では行の中に書く。ループ 18 #23・21） */}
          {item.done && (
            <span className={`${item.canDone && t.startMin <= now ? "hidden print:block" : "block"} text-[14px] font-bold text-[var(--cn-accent)] print:text-[var(--cn-ink)]`}>✓ 終わった</span>
          )}
          {item.target && <span className="text-[14px]"> {item.target}</span>}
          {t.place && <span className="block text-[14px]">{t.place}</span>}
          {item.together.length > 0 && <span className="block text-[14px]">一緒に: {item.together.map((p) => p.surname).join("・")}</span>}
        </span>
        <span aria-hidden="true" className="cn-noprint text-[var(--cn-muted)]">
          ›
        </span>
      </Link>
      {/* 印は始まった業務だけ（先の行で押し間違えないように。先に終えた人も、始まった後なら押せる） */}
      {item.canDone && t.startMin <= now && (
        <span className={`cn-noprint flex items-center pr-3 ${item.current ? "w-full justify-end pb-3 pl-4" : "max-sm:w-full max-sm:justify-end max-sm:pb-3 max-sm:pl-4"}`}>
          <DoneButton task={t} size="sm" />
        </span>
      )}
    </li>
  );
}

function FocusCard({ item, open, now, upcoming }: { item: MyItem; open: boolean; now: number; upcoming?: boolean }) {
  const t = item.task;
  const id = `fc-${t.id}`;
  // 読み上げ名は Link の中の文字そのまま（時刻・業務名・中身・「くわしく見る」）。名前と見える文字がずれないように（2.5.3）
  return (
    // いまの時間の予定は左に紺の太い帯（決定記録 0019）。終わった印のあとは薄い枠に戻す
    // 「つぎ」には帯と影を付けない（いまの予定より控えめに。ループ 18）
    <div
      className={`rounded-xl border-2 bg-white ${
        item.done ? "border-[var(--cn-card-line)]" : upcoming ? "border-[var(--cn-control-line)]" : "border-[var(--cn-accent)] border-l-[10px] shadow-[0_2px_8px_rgba(29,92,138,0.15)]"
      }`}
    >
    <Link href={meHref(t.id)} className="block p-4">
      <p id={`${id}-time`} className="text-[16px] font-bold">
        {fmtRange(t.startMin, t.endMin)}
      </p>
      <p id={`${id}-title`} className="text-[20px] font-bold leading-snug">
        {item.title}
      </p>
      <div id={`${id}-body`}>
      {item.target && <p>{item.target}</p>}
      {t.place && <p className="text-[var(--cn-ink-soft)]">場所: {t.place}</p>}
      {!item.isBreak && (
        <p className="text-[var(--cn-ink-soft)]">一緒に: {item.together.length > 0 ? item.together.map((p) => p.surname).join("・") : t.headcount > 1 ? "まだ決まっていません" : "なし（ひとりで入ります）"}</p>
      )}
      {/* 初回の人には、お願いすること・しないこと・物品を開いて出す */}
      {open && t.scopeNote && (
        <p className="mt-2 rounded-lg bg-[var(--cn-accent-soft)] p-2.5">
          <span className="font-bold">お願いすること: </span>
          {t.scopeNote}
        </p>
      )}
      {open && t.outOfScopeNote && (
        <p className="mt-2 rounded-lg border border-[var(--cn-control-line)] p-2.5">
          <span className="font-bold">お願いしないこと: </span>
          {t.outOfScopeNote}
        </p>
      )}
      {open && t.supplies && (
        <p className="mt-2">
          <span className="font-bold">物品: </span>
          {t.supplies}
        </p>
      )}
      </div>
      <p className="mt-3 inline-flex min-h-[44px] items-center gap-1 rounded-lg bg-[var(--cn-accent-soft)] px-3 text-[16px] font-bold text-[var(--cn-accent)]">
        <span id={`${id}-more`}>くわしく見る</span> <span aria-hidden="true">›</span>
      </p>
    </Link>
    {item.canDone && t.startMin <= now && (
      <div className="flex items-center justify-between gap-2 border-t border-[var(--cn-grid)] px-4 py-2">
        <span className="text-[14px] text-[var(--cn-ink-soft)]">{doneHint(t, item.together.length)}</span>
        <DoneButton task={t} />
      </div>
    )}
    </div>
  );
}
