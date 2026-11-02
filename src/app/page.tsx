import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-4 py-10">
      <header className="flex items-center gap-3">
        <span className="inline-block h-7 w-7 rounded-lg bg-[var(--cn-accent)]" aria-hidden="true" />
        <h1 className="text-2xl font-bold">ケアナビ</h1>
        <span className="text-sm text-[var(--cn-muted)]">仕事に、人を付ける。</span>
      </header>
      <p className="max-w-2xl">
        介護現場の一日を業務の時間割にし、必要な仕事に人を付け、一人ひとりに「いつ・どこで・誰に・何を」を案内します。
        まずはサンプル施設で、時間割と配置を触ってみてください。
      </p>
      <div className="flex flex-wrap gap-3">
        <Link
          href="/board"
          className="inline-flex h-12 items-center rounded-xl bg-[var(--cn-accent)] px-5 text-base font-bold text-white"
        >
          サンプル施設で試す
        </Link>
        <Link
          href="/setup"
          className="inline-flex h-12 items-center rounded-xl border border-[var(--cn-border)] bg-white px-5 text-base"
        >
          自分の施設で始める
        </Link>
      </div>
    </main>
  );
}
