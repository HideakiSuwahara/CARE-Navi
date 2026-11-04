"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { assigneesOf, canMarkDone } from "@/domain/checks";
import { residentLabel } from "@/domain/display";
import { leaderContact, staffTaskName, targetLines } from "@/domain/myday";
import { clockLabel, fmtMin, fmtRange } from "@/domain/time";
import type { ID, State } from "@/domain/types";
import { contactText, HelpBar } from "./HelpBar";
import { LAST_TASK_KEY, meHref } from "./links";
import { DoneButton, DoneToast, doneHint } from "@/components/DoneButton";

/** 対象の方がこの人数までなら、はじめから全員を出す */
const SHOW_ALL_UP_TO = 10;

/**
 * 業務詳細（スマホ）。docs/screens.md §5
 * 上から: 戻る・業務名・時刻・場所・一緒に・「終わった」の印 → お願いすること／しないこと（太枠）→ 物品（1 行）→ 対象の方（お一人ずつの注意）→ 手順 → 困ったら。
 * 対象の方は手順より上に置く（決定記録 0010 決定 5: 「この時間に、誰に、どんな注意が要るか」を先に。物品は 1 行なので先に）。
 * 内容の記録は置かない。「終わった」の印だけ（決定記録 0010 決定 2）。
 */
export function PhoneTaskDetail({ state, date, taskId, me, now }: { state: State; date: string; taskId: ID; me: ID; now: number }) {
  // 呼ぶ側（MyPage）で、予定があることを確かめてから開く
  const task = state.tasks[taskId]!;
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [showAll, setShowAll] = useState(false);
  const firstHidden = useRef<HTMLLIElement>(null);
  const expanded = useRef(false);
  useEffect(() => {
    window.scrollTo(0, 0);
    titleRef.current?.focus();
    try {
      window.sessionStorage.setItem(LAST_TASK_KEY, taskId);
    } catch {
      // 保存できない端末では、戻ったときに見出しへ
    }
  }, [taskId]);
  // 「ほか n 人を見る」で開いたら、続きの最初の方へフォーカスを移す
  useEffect(() => {
    if (showAll && !expanded.current) {
      expanded.current = true;
      firstHidden.current?.focus();
    }
  }, [showAll]);
  const mode = state.facility?.settings.residentDisplayMode ?? "roomAndSurname";
  const ids = state.targets[task.id] ?? [];
  const individual = task.targetMode === "individual" && ids[0] ? state.residents[ids[0]] : undefined;
  const name = staffTaskName(task);
  const title = individual ? `${name} ${residentLabel(individual, mode)}様` : name;
  const group = task.groupId ? state.groups[task.groupId] : undefined;
  const isBreak = task.kind === "break";
  // 休憩は一緒に入る業務ではないので出さない
  const together = isBreak ? [] : assigneesOf(state, task.id).filter((s) => s.id !== me);
  const limit = showAll || ids.length <= SHOW_ALL_UP_TO ? ids.length : 6;
  const { lines, more, supportShown } = targetLines(state, task, me, now, limit);
  // 先の業務なら、その業務の始まる時刻の相談先（10:00 に 19:00 の業務を開いても、19:00 の人を出す）
  const at = task.startMin > now ? task.startMin : now;
  const leader = leaderContact(state, date, at);
  const entry = Object.values(state.roster).find((e) => e.date === date && e.staffId === me);
  const beforeShift = entry ? now < entry.startMin : false;

  // タブの題名も業務名に（タブの一覧・履歴で区別できるように）
  useEffect(() => {
    const prev = document.title;
    document.title = `${title} ${fmtRange(task.startMin, task.endMin)} — 自分の予定 — ケアナビ`;
    return () => {
      document.title = prev;
    };
  }, [title, task.startMin, task.endMin]);

  return (
    <main className="mx-auto min-h-screen max-w-[480px] bg-[var(--cn-ground)] pb-[88px] text-[16px]">
      <HelpBar state={state} date={date} me={me} now={now} />
      <div className="bg-white px-4 pb-4 pt-2">
        <Link href={meHref()} className="-ml-2 inline-flex h-[44px] items-center px-2 text-[16px] text-[var(--cn-accent)]">
          <span aria-hidden="true">‹</span> 自分の予定へ戻る
        </Link>
        <h1 ref={titleRef} tabIndex={-1} className="text-[22px] font-bold leading-snug outline-none">
          {title}
        </h1>
        <p className="text-[var(--cn-ink-soft)]">
          {fmtRange(task.startMin, task.endMin)}
          {group && group.kind !== "common" && ` ・ ${group.name}`}
        </p>
        {task.place && <p>場所: {task.place}</p>}
        {!isBreak && (
          <p>
            一緒に:{" "}
            {together.length > 0
              ? together.map((s, i) => (
                  <span key={s.id}>
                    {i > 0 && "・"}
                    <span className="font-bold">{s.surname}</span>
                    {s.phone && ` PHS ${s.phone}`}
                  </span>
                ))
              : "なし（ひとりで入ります）"}
          </p>
        )}
        {canMarkDone(task) && (
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--cn-grid)] pt-3">
            <span className="text-[14px] text-[var(--cn-ink-soft)]">{doneHint(task, together.length)}</span>
            <DoneButton task={task} />
          </div>
        )}
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

        {lines.length > 0 && (
          <section className="rounded-xl bg-white p-4" aria-labelledby="pt-targets">
            <h2 id="pt-targets" className="text-[16px] font-bold">
              対象の方 {ids.length}人
            </h2>
            <ul className="mt-1 flex flex-col divide-y divide-[var(--cn-grid)]">
              {lines.map((l, i) => (
                <li key={l.residentId} ref={i === 6 ? firstHidden : undefined} tabIndex={i === 6 ? -1 : undefined} className="py-2">
                  <div className="flex items-baseline gap-2">
                    <span className="font-bold">{l.label}様</span>
                    {l.timeMin !== undefined && <span className="ml-auto font-bold">{clockLabel(l.timeMin)}</span>}
                  </div>
                  {l.support && (
                    <p className="ml-3 border-l-2 border-[var(--cn-control-line)] pl-2 text-[14px] text-[var(--cn-ink-soft)]">
                      {l.support}
                    </p>
                  )}
                </li>
              ))}
            </ul>
            {more > 0 && (
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="mt-2 h-[44px] w-full rounded-lg border border-[var(--cn-control-line)] text-[16px]"
              >
                ほか {more} 人を見る
              </button>
            )}
            {lines.some((l) => l.timeMin !== undefined) && <p className="mt-2 text-[14px] text-[var(--cn-muted)]">右の時刻は、いつもと違う時刻の方です。</p>}
            <p className="mt-1 text-[14px] text-[var(--cn-muted)]">
              {beforeShift && !supportShown && entry
                ? `お一人ずつの注意点がある方は、勤務が始まる ${fmtMin(entry.startMin)} からここに出ます。お一人ずつの介助のしかたは、一緒に入る人か相談先に聞いてください。`
                : "ほかに気になることは、相談先に確認してください。"}
            </p>
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

        <section className="rounded-xl bg-white p-4" aria-labelledby="pt-help">
          <h2 id="pt-help" className="text-[16px] font-bold">
            困ったら
          </h2>
          <ul className="mt-1 flex flex-col gap-1">
            <li>
              {task.startMin > now ? `${fmtMin(task.startMin)} の相談先: ` : "いまの相談先: "}
              <span className="font-bold">{contactText(leader, me)}</span>
            </li>
            {task.contact && <li className="text-[14px] text-[var(--cn-ink-soft)]">この業務の相談先: {task.contact}</li>}
          </ul>
        </section>

        <Link href={meHref()} className="inline-flex h-[44px] items-center text-[16px] text-[var(--cn-accent)]">
          <span aria-hidden="true">‹</span> 自分の予定へ戻る
        </Link>
      </div>
      <DoneToast />
    </main>
  );
}
