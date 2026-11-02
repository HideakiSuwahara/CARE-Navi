"use client";

import { leaderContact, type ContactPerson } from "@/domain/myday";
import { fmtRange } from "@/domain/time";
import type { ID, State } from "@/domain/types";

const phs = (p: ContactPerson) => (p.phone ? ` PHS ${p.phone}` : "");

/**
 * 上部に常に出す1行「困ったら 佐藤（リーダー）PHS 801」。docs/screens.md §4
 * リーダーが休憩中なら「休憩中 13:00–14:00 → 高橋 PHS 802」。
 */
export function HelpBar({ state, date, me, now }: { state: State; date: string; me: ID; now: number }) {
  const c = leaderContact(state, date, now);
  if (!c) return null;
  const self = c.leader.staffId === me;
  return (
    <p className="sticky top-0 z-20 border-b border-[var(--cn-control-line)] bg-[var(--cn-accent-soft)] px-4 py-2.5 text-[16px] print:static" role="note" aria-label="困ったら">
      <span className="font-bold">困ったら</span>{" "}
      {c.onBreak ? (
        <>
          {c.leader.surname}（リーダー）は休憩中 {fmtRange(c.onBreak.startMin, c.onBreak.endMin)} →{" "}
          {c.substitute ? (
            <span className="font-bold">
              {c.substitute.surname}
              {phs(c.substitute)}
            </span>
          ) : (
            "近くの職員へ"
          )}
        </>
      ) : self ? (
        <>きょうのリーダーはあなたです</>
      ) : (
        <span className="font-bold">
          {c.leader.surname}（リーダー）{phs(c.leader)}
        </span>
      )}
    </p>
  );
}
