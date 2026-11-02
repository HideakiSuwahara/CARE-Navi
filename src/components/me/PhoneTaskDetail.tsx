"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { assigneesOf } from "@/domain/checks";
import { residentLabel } from "@/domain/display";
import { leaderContact, targetLines } from "@/domain/myday";
import { clockLabel, fmtRange } from "@/domain/time";
import type { ID, State } from "@/domain/types";
import { HelpBar } from "./HelpBar";
import { meHref } from "./links";

/**
 * 業務詳細（スマホ）。docs/screens.md §5
 * 上から: 戻る・業務名・時刻・場所 → お願いすること／しないこと（太枠）→ 物品 → 手順 → 対象の方 → 困ったら。
 * 記録ボタンは置かない。
 */
export function PhoneTaskDetail({ state, date, taskId, me, now }: { state: State; date: string; taskId: ID; me: ID; now: number }) {
  const task = state.tasks[taskId];
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    window.scrollTo(0, 0);
    titleRef.current?.focus();
  }, [taskId]);
  if (!task) return null;
  const mode = state.facility?.settings.residentDisplayMode ?? "roomAndSurname";
  const ids = state.targets[task.id] ?? [];
  const individual = task.targetMode === "individual" && ids[0] ? state.residents[ids[0]] : undefined;
  const title = individual ? `${task.name} ${residentLabel(individual, mode)}様` : task.name;
  const group = task.groupId ? state.groups[task.groupId] : undefined;
  const together = assigneesOf(state, task.id).filter((s) => s.id !== me);
  const { lines, more, supportShown } = targetLines(state, task, me, now);
  const leader = leaderContact(state, date, now);
  const isBreak = task.kind === "break";

  return (
    <main className="mx-auto min-h-screen max-w-[480px] bg-[var(--cn-ground)] pb-10 text-[16px]">
      <HelpBar state={state} date={date} me={me} now={now} />
      <div className="bg-white px-4 pb-4 pt-2">
        <Link href={meHref()} className="-ml-2 inline-flex h-[44px] items-center px-2 text-[16px] text-[var(--cn-accent)]">
          ‹ 自分の予定へ戻る
        </Link>
        <h1 ref={titleRef} tabIndex={-1} className="text-[22px] font-bold leading-snug outline-none">
          {title}
        </h1>
        <p className="text-[16px] text-[var(--cn-ink-soft)]">
          {fmtRange(task.startMin, task.endMin)}
          {group && group.kind !== "common" && ` ・ ${group.name}`}
        </p>
        {task.place && <p className="text-[16px]">場所: {task.place}</p>}
      </div>

      <div className="flex flex-col gap-4 px-4 pt-4">
        {(task.scopeNote || task.outOfScopeNote) && (
          <section className="rounded-xl border-[3px] border-[var(--cn-accent)] bg-white p-4">
            {task.scopeNote && (
              <>
                <h2 className="text-[16px] font-bold text-[var(--cn-accent)]">あなたにお願いすること</h2>
                <p className="mt-1">{task.scopeNote}</p>
              </>
            )}
            {task.outOfScopeNote && (
              <>
                <h2 className="mt-3 text-[16px] font-bold">お願いしないこと</h2>
                <p className="mt-1">{task.outOfScopeNote}</p>
              </>
            )}
          </section>
        )}

        {task.supplies && (
          <section className="rounded-xl bg-white p-4">
            <h2 className="text-[16px] font-bold">物品の場所</h2>
            <p className="mt-1">{task.supplies}</p>
          </section>
        )}

        {!isBreak && (
          <section className="rounded-xl bg-white p-4">
            <h2 className="text-[16px] font-bold">この施設の手順</h2>
            {task.procedure && task.procedure.length > 0 ? (
              <ol className="mt-1 list-decimal pl-6">
                {task.procedure.map((p, i) => (
                  <li key={i} className="py-0.5">
                    {p}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-1">手順はまだ登録されていません。相談先に確認してください。</p>
            )}
          </section>
        )}

        {lines.length > 0 && (
          <section className="rounded-xl bg-white p-4" aria-labelledby="pt-targets">
            <h2 id="pt-targets" className="text-[16px] font-bold">
              対象の方 {ids.length}人
            </h2>
            <ul className="mt-1 flex flex-col divide-y divide-[var(--cn-grid)]">
              {lines.map((l) => (
                <li key={l.residentId} className="py-2">
                  <div className="flex items-baseline gap-2">
                    <span className="font-bold">{l.label}様</span>
                    {l.timeMin !== undefined && <span className="ml-auto font-bold">{clockLabel(l.timeMin)}</span>}
                  </div>
                  {l.support && <p className="text-[14px] text-[var(--cn-ink-soft)]">{l.support}</p>}
                </li>
              ))}
            </ul>
            {more > 0 && <p className="mt-1 text-[14px] text-[var(--cn-muted)]">ほか {more} 人</p>}
            {lines.some((l) => l.timeMin !== undefined) && <p className="mt-1 text-[14px] text-[var(--cn-muted)]">右の時刻は、いつもと違う時刻の方です。</p>}
            <p className="mt-1 text-[14px] text-[var(--cn-muted)]">
              利用者ごとの介助方法は、相談先に確認してください。{!supportShown && "方ごとのサポートは、この業務の担当の方に、勤務時間中に出ます。"}
            </p>
          </section>
        )}

        <section className="rounded-xl bg-white p-4" aria-labelledby="pt-help">
          <h2 id="pt-help" className="text-[16px] font-bold">
            困ったら
          </h2>
          <ul className="mt-1 flex flex-col gap-1">
            {together.map((s) => (
              <li key={s.id}>
                一緒に入る人: <span className="font-bold">{s.surname}</span>
                {s.phone && ` PHS ${s.phone}`}
              </li>
            ))}
            {leader && (
              <li>
                きょうのリーダー: <span className="font-bold">{leader.leader.surname}</span>
                {leader.leader.phone && ` PHS ${leader.leader.phone}`}
                {leader.onBreak && (
                  <>
                    （休憩中 {fmtRange(leader.onBreak.startMin, leader.onBreak.endMin)}
                    {leader.substitute && ` → ${leader.substitute.surname}${leader.substitute.phone ? ` PHS ${leader.substitute.phone}` : ""}`}）
                  </>
                )}
              </li>
            )}
            {task.contact && <li className="text-[14px] text-[var(--cn-ink-soft)]">この業務の相談先: {task.contact}</li>}
          </ul>
        </section>
      </div>
    </main>
  );
}
