"use client";

import { useCallback, useEffect, useState } from "react";
import { rosterForDate } from "@/domain/checks";
import { canSeeAll } from "@/domain/leader";
import { viewerDay } from "@/domain/myday";
import { addDays } from "@/domain/pattern";
import { fmtRange } from "@/domain/time";
import type { ID } from "@/domain/types";
import { useAppState, useNowMinutes } from "@/store/react";
import { SAMPLE_DATE } from "@/store/sample";
import { AllView } from "./AllView";
import { LeaderTabs } from "./LeaderTabs";
import { MyDayView } from "./MyDayView";
import { PhoneTaskDetail } from "./PhoneTaskDetail";

/**
 * 自分の予定（スマホ）。docs/screens.md §4
 * 共有端末: はじめに名前を選ぶ（その端末が覚える）。名前の横の「切替」で変えられる。
 */
const ME_KEY = "cn-me-staff";

function readMe(): ID | null {
  try {
    return window.localStorage.getItem(ME_KEY);
  } catch {
    return null;
  }
}
function writeMe(id: ID | null) {
  try {
    if (id) window.localStorage.setItem(ME_KEY, id);
    else window.localStorage.removeItem(ME_KEY);
  } catch {
    // 保存できない端末（プライベートモードなど）では、開いている間だけ覚える
  }
}

export function MyPage({ taskId, date = SAMPLE_DATE, view: viewKey }: { taskId?: string; date?: string; view?: "all" }) {
  const { state, ready } = useAppState();
  const clock = useNowMinutes();
  const [me, setMe] = useState<ID | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setMe(readMe());
    setLoaded(true);
  }, []);

  const choose = useCallback((id: ID | null) => {
    writeMe(id);
    setMe(id);
    window.scrollTo(0, 0);
  }, []);

  if (!ready || !loaded || clock === null) {
    return <p className="p-5 text-[16px] text-[var(--cn-muted)]">読み込んでいます…</p>;
  }

  // 夜勤明けの人は前の業務日（夜勤が始まった日）を開く。それ以外は date のまま（夜勤帯の業務はその夜勤が始まった業務日に属する）
  const view = viewerDay(state, date, me, clock);
  const bizDate = view.date;
  const now = view.now;
  const entry = me ? rosterForDate(state, bizDate).find((e) => e.staffId === me && !e.absent) : undefined;
  if (!me || !state.staff[me] || !entry) return <NamePicker state={state} date={date} clock={clock} onChoose={choose} previous={me && state.staff[me] ? state.staff[me].surname : undefined} />;
  const date_ = bizDate;
  if (taskId && state.tasks[taskId]) {
    return <PhoneTaskDetail state={state} date={date_} taskId={taskId} me={me} now={now} />;
  }
  // リーダーの番の人には、画面下に［自分｜全体］（docs/screens.md §4.1）
  const leader = canSeeAll(state, date_, me);
  if (leader && viewKey === "all") {
    return <AllView state={state} date={date_} me={me} now={now} clock={clock} tabs={<LeaderTabs current="all" />} />;
  }
  return (
    <>
      <MyDayView state={state} date={date_} me={me} now={now} onSwitch={() => choose(null)} missingTask={Boolean(taskId)} />
      {leader && (
        <>
          <div aria-hidden="true" className="h-[72px] print:hidden" />
          <div className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-[480px] border-t border-[var(--cn-control-line)] bg-white print:hidden">
            <LeaderTabs current="me" />
          </div>
        </>
      )}
    </>
  );
}

function NamePicker({
  state,
  date,
  clock,
  onChoose,
  previous,
}: {
  state: ReturnType<typeof useAppState>["state"];
  date: string;
  clock: number;
  onChoose: (id: ID) => void;
  /** 覚えていた人が、きょうは出勤していないとき */
  previous?: string;
}) {
  const slotOrder = (id?: ID) => (id ? (state.roleSlots[id]?.sortOrder ?? 999) : 999);
  // 夜勤明け（前の業務日の勤務がまだ続いている人）も、きょうの出勤者の前に並べる
  const overnight = rosterForDate(state, addDays(date, -1))
    .filter((e) => !e.absent && state.staff[e.staffId] && e.endMin > 1440 && e.startMin <= clock + 1440 && clock + 1440 < e.endMin)
    .sort((a, b) => slotOrder(a.slotId) - slotOrder(b.slotId));
  const today = rosterForDate(state, date)
    .filter((e) => !e.absent && state.staff[e.staffId] && !overnight.some((o) => o.staffId === e.staffId))
    .sort((a, b) => slotOrder(a.slotId) - slotOrder(b.slotId) || a.startMin - b.startMin);
  const entries = [...overnight.map((e) => ({ ...e, overnight: true })), ...today.map((e) => ({ ...e, overnight: false }))];
  return (
    <main className="mx-auto flex min-h-screen max-w-[480px] flex-col gap-4 bg-[var(--cn-ground)] px-4 py-5 text-[16px]">
      <h1 className="text-[20px] font-bold">自分の予定</h1>
      {previous && <p className="text-[16px]">{previous}さんは、きょうの出勤に入っていません。名前を選び直してください。</p>}
      <p className="text-[16px] text-[var(--cn-ink-soft)]">あなたの名前を選んでください。この端末が覚えます。</p>
      {entries.length === 0 && (
        <div className="flex flex-col items-start gap-3 rounded-xl bg-white p-4">
          <p>きょうの出勤者がまだ入っていません。リーダーが今日の時間割を作ると、ここに名前が出ます。</p>
          <button type="button" onClick={() => window.location.reload()} className="h-[48px] rounded-xl border border-[var(--cn-control-line)] px-4 font-bold">
            もう一度読み込む
          </button>
        </div>
      )}
      <ul className="flex flex-col gap-2" aria-label="きょうの出勤者">
        {entries.map((e) => {
          const s = state.staff[e.staffId];
          const slot = e.slotId ? state.roleSlots[e.slotId]?.name : "";
          return (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => onChoose(s.id)}
                className="flex min-h-[56px] w-full items-center gap-3 rounded-xl border border-[var(--cn-control-line)] bg-white px-4 text-left"
              >
                <span className="text-[18px] font-bold">{s.surname}</span>
                {e.firstTimer && <span className="rounded border border-[var(--cn-control-line)] px-1.5 text-[14px]">初回</span>}
                {e.overnight && <span className="rounded border border-[var(--cn-control-line)] px-1.5 text-[14px]">夜勤明け</span>}
                <span className="text-[14px] text-[var(--cn-muted)]">
                  {slot} {fmtRange(e.startMin, e.endMin)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
