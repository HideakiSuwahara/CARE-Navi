"use client";

import { leaderContact, type ContactPerson, type LeaderContact } from "@/domain/myday";
import { fmtRange } from "@/domain/time";
import type { ID, State } from "@/domain/types";

const phs = (p: ContactPerson) => (p.phone ? ` PHS ${p.phone}` : "");

/** 「佐藤（リーダー）PHS 801」。施設がリーダーの番を決めていなければ「佐藤（早番A）PHS 801」 */
export function contactName(c: LeaderContact): string {
  return `${c.leader.surname}（${c.isLeader ? "リーダー" : c.slotName || "勤務中"}）${phs(c.leader)}`;
}

/** 相談先の1文（帯と業務詳細で同じ言い方にする） */
export function contactText(c: LeaderContact | undefined, me: ID): string {
  if (!c) return "近くの職員へ（詰所）";
  if (c.onBreak) {
    const range = fmtRange(c.onBreak.startMin, c.onBreak.endMin);
    if (c.leader.staffId === me) return `あなたの休憩中（${range}）の相談先は ${c.substitute ? `${c.substitute.surname}${phs(c.substitute)}` : "近くの職員"}`;
    const who = !c.substitute ? "近くの職員へ" : c.substitute.staffId === me ? "代わりはあなたです" : `${c.substitute.surname}${phs(c.substitute)}`;
    return `${c.leader.surname}（${c.isLeader ? "リーダー" : c.slotName}）は休憩中 ${range} → ${who}`;
  }
  // リーダー本人: 次の相談先（勤務中で次に順の人）を出す。いなければ詰所
  if (c.leader.staffId === me) {
    const next = c.next ? `${c.next.surname}${phs(c.next)}` : "近くの職員へ（詰所）";
    return c.isLeader ? `いまのリーダーはあなたです。相談先: ${next}` : next;
  }
  return contactName(c);
}

/**
 * 上部に常に出す1行「困ったら 佐藤（リーダー）PHS 801」。docs/screens.md §4
 * リーダーが休憩中なら「休憩中 13:00–14:00 → 高橋 PHS 802」。勤務中の人がいない時刻も帯は残す。
 */
export function HelpBar({ state, date, me, now }: { state: State; date: string; me: ID; now: number }) {
  const c = leaderContact(state, date, now);
  return (
    <p className="sticky top-0 z-20 border-b border-[var(--cn-control-line)] bg-[var(--cn-accent-soft)] px-4 py-2.5 text-[16px] print:hidden" role="note">
      <span className="font-bold">困ったら</span> <span className="font-bold">{contactText(c, me)}</span>
    </p>
  );
}
