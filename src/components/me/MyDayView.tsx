"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { tasksForDate } from "@/domain/checks";
import { leaderSchedule, myDay, type MyItem } from "@/domain/myday";
import { fmtMin, fmtRange } from "@/domain/time";
import type { ID, State } from "@/domain/types";
import { contactName, HelpBar } from "./HelpBar";
import { LAST_TASK_KEY, meHref } from "./links";

/**
 * 自分の予定の本文。docs/screens.md §4
 * - 「いまの時間の予定」。なければ「最初の予定」（勤務前）または「つぎ」を同じ大きさで。
 * - 「きょうの流れ」: 時刻順。過ぎた予定は薄く、いまの位置に「● いまの時間」。最後に「退勤」。
 * - 充足バッジ・仕組みの言葉は出さない。終わったかどうかは記録しない。
 * - 初回の人には、お願いすること・お願いしないこと・物品を開いて出す（勤務中も）。
 */
export function MyDayView({
  state,
  date,
  me,
  now,
  onSwitch,
  missingTask = false,
}: {
  state: State;
  date: string;
  me: ID;
  now: number;
  onSwitch: () => void;
  /** ?task= の予定が見つからなかった（変更・中止された） */
  missingTask?: boolean;
}) {
  const day = useMemo(() => myDay(state, date, me, now), [state, date, me, now]);
  const hasDay = useMemo(() => tasksForDate(state, date).length > 0, [state, date]);
  const [menu, setMenu] = useState(false);
  const menuWrap = useRef<HTMLDivElement>(null);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

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

  useEffect(() => {
    const stamp = () => {
      const d = new Date();
      setPrintedAt(`${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`);
    };
    stamp();
    window.addEventListener("beforeprint", stamp);
    return () => window.removeEventListener("beforeprint", stamp);
  }, []);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMenu(false);
      menuBtn.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

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
    <main className="mx-auto min-h-screen max-w-[480px] bg-[var(--cn-ground)] pb-10 text-[16px] print:max-w-none print:bg-white">
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
        <div ref={menuWrap} className="cn-noprint relative" onBlur={(e) => !menuWrap.current?.contains(e.relatedTarget as Node) && setMenu(false)}>
          <button
            ref={menuBtn}
            type="button"
            aria-expanded={menu}
            aria-controls="me-menu"
            aria-label="ほかの操作"
            onClick={() => setMenu((v) => !v)}
            className="inline-flex h-[44px] w-[44px] items-center justify-center rounded-lg border border-[var(--cn-control-line)] bg-white text-[18px] font-bold"
          >
            ⋯
          </button>
          {menu && (
            <div id="me-menu" className="absolute right-0 top-[48px] z-30 w-[220px] overflow-hidden rounded-xl border border-[var(--cn-border)] bg-white py-1 shadow-lg">
              <button
                type="button"
                autoFocus
                onClick={() => {
                  setMenu(false);
                  menuBtn.current?.focus();
                  window.print();
                }}
                className="flex min-h-[44px] w-full items-center px-4 text-left text-[16px]"
              >
                印刷
              </button>
            </div>
          )}
        </div>
      </header>

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
                <FocusCard key={i.task.id} item={i} open={firstTimer} />
              ))}
            </div>
            {day.upcoming && (
              <>
                <h2 className="mb-2 mt-4 text-[18px] font-bold">つぎ</h2>
                <FocusCard item={day.upcoming} open={firstTimer} />
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
            {flowWithNow(day.items, now, day.entry.startMin, day.entry.endMin).map((row) =>
              row.kind === "now" ? (
                <li key="now" className="cn-noprint flex items-center gap-2 border-y-2 border-[var(--cn-now)] px-4 py-1.5 text-[16px] font-bold text-[var(--cn-now)]">
                  ● いまの時間 {fmtMin(now)}
                </li>
              ) : row.kind === "end" ? (
                <li key="end" className="flex items-baseline gap-3 px-4 py-3">
                  <span className="w-[96px] shrink-0 font-bold">{fmtMin(day.entry.endMin)}</span>
                  <span>退勤</span>
                </li>
              ) : (
                <FlowRow key={row.item.task.id} item={row.item} />
              ),
            )}
          </ol>
        </section>
      </div>
    </main>
  );
}

type FlowRowData = { kind: "item"; item: MyItem } | { kind: "now" } | { kind: "end" };

/** きょうの流れに「● いまの時間」を差し込む（勤務時間中だけ） */
function flowWithNow(items: MyItem[], now: number, start: number, end: number): FlowRowData[] {
  const rows: FlowRowData[] = [];
  const showNow = now >= start && now < end;
  let placed = false;
  for (const item of items) {
    if (showNow && !placed && item.task.startMin > now) {
      rows.push({ kind: "now" });
      placed = true;
    }
    rows.push({ kind: "item", item });
  }
  if (showNow && !placed) rows.push({ kind: "now" });
  rows.push({ kind: "end" });
  return rows;
}

function FlowRow({ item }: { item: MyItem }) {
  const t = item.task;
  return (
    <li className="break-inside-avoid border-b border-[var(--cn-grid)] last:border-b-0 print:border-b-[#9a9fa5]">
      <Link
        href={meHref(t.id)}
        data-flow-task={t.id}
        className={`flex min-h-[52px] items-baseline gap-3 px-4 py-3 print:min-h-0 print:py-1 print:text-[var(--cn-ink)] ${item.past ? "text-[var(--cn-muted)]" : ""} ${item.current ? "bg-[var(--cn-accent-soft)]" : ""}`}
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
          {item.past && <span className="sr-only">（時刻を過ぎた予定）</span>}
          <span className={item.current ? "font-bold" : ""}>{item.title}</span>
          {item.target && <span className="text-[14px]"> {item.target}</span>}
          {t.place && <span className="block text-[14px]">{t.place}</span>}
          {item.together.length > 0 && <span className="block text-[14px]">一緒に: {item.together.map((p) => p.surname).join("・")}</span>}
        </span>
        <span aria-hidden="true" className="cn-noprint text-[var(--cn-muted)]">
          ›
        </span>
      </Link>
    </li>
  );
}

function FocusCard({ item, open }: { item: MyItem; open: boolean }) {
  const t = item.task;
  const id = `fc-${t.id}`;
  // 読み上げ名は時刻・業務名・「くわしく見る」だけにし、中身は説明として読む（初回の人のカードは文章が長い）
  return (
    <Link
      href={meHref(t.id)}
      aria-labelledby={`${id}-time ${id}-title ${id}-more`}
      aria-describedby={`${id}-body`}
      className="block rounded-xl border-2 border-[var(--cn-accent)] bg-white p-4"
    >
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
        <p className="text-[var(--cn-ink-soft)]">一緒に: {item.together.length > 0 ? item.together.map((p) => p.surname).join("・") : "なし（ひとりで入ります）"}</p>
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
      <p className="mt-2 text-[16px] font-bold text-[var(--cn-accent)]">
        <span id={`${id}-more`}>くわしく見る</span> <span aria-hidden="true">›</span>
      </p>
    </Link>
  );
}
