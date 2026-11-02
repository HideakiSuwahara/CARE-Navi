"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { leaderContact, myDay, type MyItem } from "@/domain/myday";
import { fmtMin, fmtRange } from "@/domain/time";
import type { ID, State } from "@/domain/types";
import { HelpBar } from "./HelpBar";
import { meHref } from "./links";

/**
 * 自分の予定の本文。docs/screens.md §4
 * - 「いまの時間の予定」。なければ「最初の予定」（勤務前）または「つぎ」を同じ大きさで。
 * - 「きょうの流れ」: 時刻順。過ぎた予定は薄く、いまの位置に「● いまの時間」。最後に「退勤」。
 * - 充足バッジ・仕組みの言葉は出さない。終わったかどうかは記録しない。
 */
export function MyDayView({ state, date, me, now, onSwitch }: { state: State; date: string; me: ID; now: number; onSwitch: () => void }) {
  const day = useMemo(() => myDay(state, date, me, now), [state, date, me, now]);
  const [menu, setMenu] = useState(false);
  const menuWrap = useRef<HTMLDivElement>(null);
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
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  if (!day) return null;
  const [, m, d] = date.split("-").map(Number);
  const wd = "日月火水木金土"[new Date(Date.UTC(Number(date.slice(0, 4)), m - 1, d)).getUTCDay()];
  const heading = day.focusMode === "now" ? "いまの時間の予定" : day.focusMode === "first" ? "最初の予定" : "つぎ";
  const firstTimer = day.entry.firstTimer;
  const leader = leaderContact(state, date, now);

  return (
    <main className="mx-auto min-h-screen max-w-[480px] bg-[var(--cn-ground)] pb-10 text-[16px] print:max-w-none print:bg-white">
      <style>{"@media print { @page { size: A4 portrait; margin: 12mm; } }"}</style>
      <header className="flex items-start gap-2 bg-white px-4 pb-3 pt-4">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-[20px] font-bold">
            {day.staff.surname} さん
            <button
              type="button"
              onClick={onSwitch}
              aria-label="名前を切り替える"
              className="cn-noprint inline-flex h-[44px] items-center rounded-lg border border-[var(--cn-control-line)] px-3 text-[14px] font-normal"
            >
              切替
            </button>
          </h1>
          <p className="text-[16px] text-[var(--cn-ink-soft)]">
            {m}/{d}（{wd}）{day.slotName} {fmtRange(day.entry.startMin, day.entry.endMin)}
            <span className="hidden print:inline"> ・ 印刷 {printedAt}</span>
          </p>
        </div>
        <div ref={menuWrap} className="cn-noprint relative" onBlur={(e) => !menuWrap.current?.contains(e.relatedTarget as Node) && setMenu(false)}>
          <button
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

      <div className="flex flex-col gap-4 px-4 pt-4">
        {day.focus.length > 0 ? (
          <section aria-labelledby="focus-title" className="cn-noprint">
            <h2 id="focus-title" className="mb-2 text-[18px] font-bold">
              {heading}
            </h2>
            <div className="flex flex-col gap-2">
              {day.focus.map((i) => (
                <FocusCard key={i.task.id} item={i} open={firstTimer && day.focusMode !== "now"} />
              ))}
            </div>
            {day.upcoming && (
              <>
                <h2 className="mb-2 mt-4 text-[18px] font-bold">つぎ</h2>
                <FocusCard item={day.upcoming} open={firstTimer && day.focusMode === "first"} />
              </>
            )}
          </section>
        ) : (
          <section className="cn-noprint rounded-xl bg-white p-4">
            <p className="text-[16px]">このあとの予定はありません。退勤は {fmtMin(day.entry.endMin)} です。</p>
          </section>
        )}

        <section aria-labelledby="flow-title">
          <h2 id="flow-title" className="mb-2 text-[18px] font-bold">
            きょうの流れ
          </h2>
          <ol className="flex flex-col overflow-hidden rounded-xl border border-[var(--cn-border)] bg-white">
            {flowWithNow(day.items, now, day.entry.startMin, day.entry.endMin).map((row) =>
              row.kind === "now" ? (
                <li key="now" className="cn-noprint flex items-center gap-2 border-y-2 border-[var(--cn-now)] px-4 py-1.5 text-[15px] font-bold text-[var(--cn-now)]">
                  ● いまの時間 {fmtMin(now)}
                </li>
              ) : row.kind === "end" ? (
                <li key="end" className="flex items-baseline gap-3 px-4 py-3">
                  <span className="w-[64px] shrink-0 font-bold">{fmtMin(day.entry.endMin)}</span>
                  <span>退勤</span>
                </li>
              ) : (
                <FlowRow key={row.item.task.id} item={row.item} />
              ),
            )}
          </ol>
        </section>

        {/* 印刷: 相談先 */}
        {leader && (
          <p className="hidden text-[14px] print:block">
            困ったら: {leader.leader.surname}（リーダー）{leader.leader.phone ? ` PHS ${leader.leader.phone}` : ""}
          </p>
        )}
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
    <li className="border-b border-[var(--cn-grid)] last:border-b-0">
      <Link
        href={meHref(t.id)}
        className={`flex min-h-[52px] items-baseline gap-3 px-4 py-3 ${item.past ? "text-[var(--cn-muted)]" : ""} ${item.current ? "bg-[var(--cn-accent-soft)]" : ""}`}
      >
        <span className="w-[64px] shrink-0 font-bold">{fmtMin(t.startMin)}</span>
        <span className="min-w-0 flex-1">
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
  return (
    <Link href={meHref(t.id)} className="block rounded-xl border-2 border-[var(--cn-accent)] bg-white p-4">
      <p className="text-[16px] font-bold">{fmtRange(t.startMin, t.endMin)}</p>
      <p className="text-[20px] font-bold leading-snug">{item.title}</p>
      {item.target && <p className="text-[16px]">{item.target}</p>}
      {t.place && <p className="text-[16px] text-[var(--cn-ink-soft)]">場所: {t.place}</p>}
      {item.together.length > 0 && <p className="text-[16px] text-[var(--cn-ink-soft)]">一緒に: {item.together.map((p) => p.surname).join("・")}</p>}
      {/* 初回の人には、お願いすることと物品を開いて出す */}
      {open && t.scopeNote && (
        <p className="mt-2 rounded-lg bg-[var(--cn-accent-soft)] p-2.5 text-[16px]">
          <span className="font-bold">お願いすること: </span>
          {t.scopeNote}
        </p>
      )}
      {open && t.supplies && (
        <p className="mt-2 text-[16px]">
          <span className="font-bold">物品: </span>
          {t.supplies}
        </p>
      )}
      <p className="mt-2 text-[14px] font-bold text-[var(--cn-accent)]">くわしく見る ›</p>
    </Link>
  );
}
