import Image from "next/image";
import Link from "next/link";
import { Logo } from "@/components/Logo";

/**
 * 最初の画面。何の道具かと、サンプル施設で試せる 3 つの場面（決定記録 0018）。
 * ここはサンプル施設の入口なので、場面の案内は常に出す（施設を作ったあとの画面の案内はサンプルのときだけ）。
 */
const scenes: { when: string; what: string; href: string; go: string }[] = [
  {
    when: "朝",
    what: "先週と同じ番（早番・遅番などの役割）で一日の時間割ができます。違うところだけ直して 1 タップ。",
    href: "/board?date=2026-11-05",
    go: "朝の準備を見る",
  },
  {
    when: "途中",
    what: "欠勤や受診の付き添いが入っても、ボタン → 選ぶ → 決定の 3 タップで組み直せます。担当が決まっていない枠には「担当未定」と出ます。",
    href: "/board",
    go: "ボードを見る",
  },
  {
    when: "初日の人",
    what: "応援や新人のスマホに、いま何を・どこで・誰と、困ったら誰に相談するかが出ます。",
    href: "/me",
    go: "スマホの画面を見る",
  },
];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:py-10">
      <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <div className="flex flex-col gap-5">
          <header className="flex items-center gap-3">
            <Logo size={40} />
            <h1 className="text-[28px] font-bold tracking-wide">ケアナビ</h1>
          </header>
          <p className="text-[26px] font-bold leading-snug text-[var(--cn-accent)] sm:text-[30px]">仕事に、人を付ける。</p>
          <p className="max-w-xl text-[16px] leading-relaxed">
            介護施設の一日の仕事を時間割にして、必要な仕事に人を付け、一人ひとりに「いつ・どこで・誰に・何を」を案内する道具です。
            人に仕事を積み上げるのではなく、仕事の枠に人を付けます。
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/board" className="inline-flex h-[52px] items-center rounded-xl bg-[var(--cn-accent)] px-6 text-[17px] font-bold text-white shadow-[0_4px_14px_rgba(29,92,138,0.35)]">
              サンプル施設で試す
            </Link>
            <Link href="/setup" className="inline-flex h-[52px] items-center rounded-xl border border-[var(--cn-control-line)] bg-white px-5 text-[16px]">
              自分の施設で始める
            </Link>
          </div>
        </div>
        {/* 製品の姿（決定記録 0019）: サンプル施設のボードと、初日の人のスマホ */}
        <figure className="relative pb-10 pr-10 sm:pb-14 sm:pr-16">
          <Image
            src="/shots/board.png"
            alt="ボード: 縦が時間、横がフロアとユニット。入浴介助に「担当あと1人」、担当の決まっていない枠に「担当未定」の札が出ている"
            width={1920}
            height={1000}
            priority
            className="cn-shot w-full rounded-xl border border-[var(--cn-border)] shadow-[0_12px_32px_rgba(28,31,35,0.18)]"
          />
          <Image
            src="/shots/me.png"
            alt="スマホの自分の予定: 上に困ったらの相談先（PHS）、最初の予定「到着・案内」、お願いすること・しないこと"
            width={824}
            height={1678}
            className="cn-shot absolute bottom-0 right-0 w-[26%] min-w-[110px] rounded-[18px] border-4 border-[var(--cn-ink)] shadow-[0_12px_28px_rgba(28,31,35,0.3)]"
          />
          <figcaption className="sr-only">ケアナビのボードとスマホの画面（架空の施設「ひまわり苑」）</figcaption>
        </figure>
      </div>

      <section aria-labelledby="scenes-title" className="flex flex-col gap-3">
        <h2 id="scenes-title" className="text-[18px] font-bold">
          サンプル施設（架空の「ひまわり苑」）で試せること
        </h2>
        <ul className="grid gap-3 md:grid-cols-3">
          {scenes.map((s) => (
            <li key={s.when} className="flex flex-col gap-2 rounded-xl border border-[var(--cn-border)] bg-white p-4">
              <span className="text-[14px] font-bold text-[var(--cn-accent)]">{s.when}</span>
              <span className="text-[15px]">{s.what}</span>
              <Link href={s.href} className="mt-auto inline-flex min-h-[44px] items-center font-bold text-[var(--cn-accent)] underline">
                {s.go} →
              </Link>
            </li>
          ))}
        </ul>
        <p className="text-[14px] text-[var(--cn-ink-soft)]">サンプル施設は 11 月 3 日（火）の一日です。時計は 10:12 から進みます。どの操作も「元に戻す」で戻せます。</p>
      </section>

      <section aria-labelledby="not-title" className="rounded-xl border border-dashed border-[var(--cn-control-line)] p-4">
        <h2 id="not-title" className="mb-1 text-[16px] font-bold">
          しないこと
        </h2>
        <p className="text-[15px]">
          介護記録（ケアの内容の記録）ではありません。持つのは「終わった」の印だけです。配置を決めるのは人で、道具は理由を一文で見せるだけです。製品の中で AI は使いません。
        </p>
      </section>
    </main>
  );
}
