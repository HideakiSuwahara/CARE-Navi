"use client";

import Link from "next/link";
import { TopBar } from "@/components/TopBar";

/**
 * 使い方（グリル U10）。使い方を忘れたときに、どこで何をするかを引く 1 画面。
 * ボタンの名前は画面の表記どおりに書く。場面ごとに「どこで → 何を押す」の 1 行と、その画面へのボタン。
 */
const SECTIONS: { title: string; items: { when: string; how: string; href?: string; go?: string }[] }[] = [
  {
    title: "毎朝",
    items: [
      { when: "今日の時間割を作る", how: "ボードの上の帯で、勤務表と違う人だけ「休み」や番を直し、「この内容で作る」。前の日（先週の同じ曜日があればその日）と同じ番で並んでいます。", href: "/board", go: "ボードを開く" },
      { when: "担当を付ける", how: "右の「きょうの出勤者」の名前をカードへ動かす。またはカードの「＋」から選ぶ。", href: "/board", go: "ボードを開く" },
      { when: "分担表を印刷する", how: "ボードの右上の「⋯」→「分担表を印刷」。", href: "/board", go: "ボードを開く" },
    ],
  },
  {
    title: "途中で変わったら",
    items: [
      { when: "欠勤・早退の連絡", how: "ボードの「欠勤・早退」（スマホは［全体］の下）→ 名前を選ぶ →「この内容で決定」。外れた枠は「＋」から埋めます。", href: "/board", go: "ボードを開く" },
      { when: "受診の付き添い・外出", how: "ボードの「付き添い・外出」→ 利用者様と時間を選ぶ →「この内容で決定」。", href: "/board", go: "ボードを開く" },
      { when: "急に来られる人が増えた", how: "ボードの右の「＋ 今日来る人を足す」→ 名前と番 →「この内容で決定」。", href: "/board", go: "ボードを開く" },
      { when: "業務の時刻をずらす・中止する", how: "カードの名前を押す → 詳細で「ずらす」「中止」。", href: "/board", go: "ボードを開く" },
    ],
  },
  {
    title: "直したいとき（どの画面か）",
    items: [
      { when: "おむつ交換などの回数・時刻（施設の日課）", how: "利用者 →「一覧」の「＋ 日課を足す」。今ある日課は、列の「標準 5:00–6:00」を押して時刻・人数を変える・外す。", href: "/residents", go: "利用者を開く" },
      { when: "ある方だけ時刻が違う・なし", how: "利用者 →「一覧」のマスを押す。複数の方は左のチェックで選んで「まとめて変える」。", href: "/residents", go: "利用者を開く" },
      { when: "利用者を足す・直す・退所", how: "利用者 → 右上の「1 人ずつ足す・直す」（名前・グループ・部屋。退所もここ）。まとめて入れるなら「名簿を貼り付ける」。", href: "/residents", go: "利用者を開く" },
      { when: "職員を足す・直す・退職", how: "設定 →「職員」の「＋ 1 人ずつ足す」、または名前を押して直す（PHS・職種・退職）。まとめて入れるなら「名簿の貼り付け」。今日から来るなら、ボードの「＋ 今日来る人を足す」も。", href: "/setup", go: "設定を開く" },
      { when: "早番・遅番など、その日の番を変える", how: "ボードの朝の帯（時間割を作る前）で「番を選ぶ」。作ったあとは「＋ 今日来る人を足す」か「欠勤・早退」。番は職員の固定の属性ではなく、その日ごとに付けます。", href: "/board", go: "ボードを開く" },
      { when: "スマホでの利用者名の出し方", how: "設定 →「手元画面（自分の予定）の利用者名」。", href: "/setup", go: "設定を開く" },
    ],
  },
  {
    title: "間違えたら",
    items: [
      { when: "いまの操作を取り消す", how: "どの画面でも「元に戻す」（ボードは右上、スマホは下）。1 回で 1 つの操作が戻ります。「この内容で作る」の直後なら、帯に戻ります。" },
      { when: "別の日を開いてしまった", how: "ボードの日付の横の「今日へ」。「‹ 前の日」「次の日 ›」で日を移れます。", href: "/board", go: "ボードを開く" },
      { when: "バッジの意味", how: "「担当未定」はまだだれも付いていない枠、「担当あと n 人」は決めた人数にあと何人か。ケアができていない数ではありません。" },
    ],
  },
  {
    title: "データの備え",
    items: [
      { when: "ブラウザのデータを消した・別の PC で開く", how: "施設コードで同期していないときは、保存はこのブラウザの中だけです。設定 →「データの備え」で、週に一度「この施設を書き出す（ファイル）」。戻すときは「ファイルから読み込む」。", href: "/setup", go: "設定を開く" },
      { when: "スマホからも見る", how: "設定 →「ほかの端末からも見る（施設コード）」で施設コードを発行し、スマホで QR を読む。", href: "/setup", go: "設定を開く" },
    ],
  },
];

export function Help() {
  return (
    <div className="flex min-h-screen flex-col">
      <TopBar current="help" />
      <main className="mx-auto flex w-full max-w-[880px] flex-col gap-5 px-4 py-5 text-[15px] sm:px-5">
        <div>
          <h2 className="text-[22px] font-bold">使い方</h2>
          <p className="mt-1 text-[var(--cn-ink-soft)]">困った場面から探してください。ボタンの名前は画面と同じです。</p>
        </div>
        {SECTIONS.map((sec) => (
          <section key={sec.title} aria-labelledby={`h-${sec.title}`} className="rounded-xl border border-[var(--cn-border)] bg-white p-4">
            <h3 id={`h-${sec.title}`} className="mb-2 text-[17px] font-bold">
              {sec.title}
            </h3>
            <dl className="flex flex-col divide-y divide-[var(--cn-grid)]">
              {sec.items.map((it) => (
                <div key={it.when} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
                  <dt className="w-full font-bold sm:w-[15em] sm:shrink-0">{it.when}</dt>
                  <dd className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1">
                    <span className="min-w-0 flex-1">{it.how}</span>
                    {it.href && (
                      <Link
                        href={it.href}
                        aria-label={`${it.when}：${it.go}`}
                        className="inline-flex h-[44px] shrink-0 items-center rounded-lg border border-[var(--cn-control-line)] bg-white px-3 text-[15px] font-bold"
                      >
                        {it.go}
                      </Link>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </main>
    </div>
  );
}
