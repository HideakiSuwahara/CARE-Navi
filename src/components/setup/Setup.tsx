"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { TopBar } from "@/components/TopBar";
import { residentLabel } from "@/domain/display";
import { himawariSeed } from "@/domain/seed";
import { buildOwnFacility, facilityCode, parseStaffPaste, settingsEvent, staffEvents } from "@/domain/setup";
import type { ResidentDisplayMode } from "@/domain/types";
import { useAppState, useEngine } from "@/store/react";
import { sampleEvents } from "@/store/sample";

/**
 * 設定（PC）。docs/screens.md §3
 * - はじめて開いたとき: ボタン2つだけ（「サンプル施設で試す」／「自分の施設で始める」）
 * - 自分の施設で始める: 1画面。施設の名前とグループ → 利用者の貼り付け → 職員の貼り付け → 登録する
 * - ふだんの設定: 施設コード／手元画面の利用者名／初回の方の警告。職員の貼り付けもここから
 */
const CHOSEN_KEY = "cn-setup-chosen";

function readChosen(): boolean {
  try {
    return window.localStorage.getItem(CHOSEN_KEY) === "1";
  } catch {
    return false;
  }
}
function writeChosen(on: boolean) {
  try {
    if (on) window.localStorage.setItem(CHOSEN_KEY, "1");
    else window.localStorage.removeItem(CHOSEN_KEY);
  } catch {
    // 保存できない端末では、開いている間だけ覚える
  }
}

export function Setup() {
  const { state, ready } = useAppState();
  const engine = useEngine();
  const router = useRouter();
  const [chosen, setChosen] = useState<boolean | null>(null);
  const [own, setOwn] = useState(false);
  useEffect(() => setChosen(readChosen()), []);

  if (!ready || chosen === null) return <p className="p-6 text-[15px] text-[var(--cn-muted)]">読み込んでいます…</p>;

  const trySample = async () => {
    if (engine && state.facility?.id !== himawariSeed.facility.id) await engine.reset(sampleEvents());
    writeChosen(true);
    router.push("/board");
  };

  if (own) {
    return (
      <Shell>
        <OwnFacilityForm
          onCancel={() => setOwn(false)}
          isSample={state.facility?.id === himawariSeed.facility.id}
          onDone={async (events) => {
            if (!engine) return;
            await engine.reset(events);
            writeChosen(true);
            router.push("/board");
          }}
        />
      </Shell>
    );
  }

  if (!chosen) {
    return (
      <Shell>
        <section aria-labelledby="start-title" className="mx-auto flex max-w-[640px] flex-col gap-5 pt-10">
          <h2 id="start-title" className="text-[22px] font-bold">
            はじめに
          </h2>
          <p className="text-[16px]">入力なしで、架空の施設（ひまわり苑）の一日を触れます。自分の施設は、名簿を貼り付けて始められます。</p>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={trySample} className="h-[56px] rounded-xl bg-[var(--cn-accent)] px-6 text-[17px] font-bold text-white">
              サンプル施設で試す
            </button>
            <button type="button" onClick={() => setOwn(true)} className="h-[56px] rounded-xl border-2 border-[var(--cn-control-line)] bg-white px-6 text-[17px] font-bold">
              自分の施設で始める
            </button>
          </div>
        </section>
      </Shell>
    );
  }

  return (
    <Shell>
      <Everyday onOwn={() => setOwn(true)} onSample={trySample} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <TopBar current="setup" />
      <main className="flex flex-col gap-4 p-5 text-[15px]">{children}</main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 自分の施設で始める（1画面、上から順に）
// ---------------------------------------------------------------------------

function OwnFacilityForm({ onCancel, onDone, isSample }: { onCancel: () => void; onDone: (events: ReturnType<typeof buildOwnFacility>["events"]) => void; isSample: boolean }) {
  const [name, setName] = useState("");
  const [groupsText, setGroupsText] = useState("");
  const [residentsText, setResidentsText] = useState("");
  const [staffText, setStaffText] = useState("");
  const [tried, setTried] = useState(0);
  const [newId] = useState(() => {
    let n = 0;
    const base = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Date.now().toString(36);
    return () => `own-${base}-${(n++).toString(36)}`;
  });
  const result = useMemo(
    () => buildOwnFacility({ name, groupsText, residentsText, staffText }, himawariSeed, { newId, ts: new Date().toISOString(), batchId: "setup" }),
    [name, groupsText, residentsText, staffText, newId],
  );

  const field = "w-full rounded-lg border border-[var(--cn-control-line)] bg-white p-2.5 text-[15px] placeholder:text-[var(--cn-muted)]";
  const nameErr = tried > 0 && !name.trim();
  const groupErr = tried > 0 && result.counts.groups === 0;
  const tags = [...new Set(himawariSeed.templates.flatMap((t) => t.requiredTags))];
  const label = "mb-1 block text-[15px] font-bold";
  return (
    <form
      aria-labelledby="own-title"
      className="mx-auto flex w-full max-w-[880px] flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        setTried((n) => n + 1);
        if (result.ok) onDone(result.events);
        else window.setTimeout(() => document.getElementById(!name.trim() ? "own-name" : "own-groups")?.focus(), 0);
      }}
    >
      <div>
        <h2 id="own-title" className="text-[22px] font-bold">
          自分の施設で始める
        </h2>
        <p className="text-[15px] text-[var(--cn-ink-soft)]">上から順に入れて「登録する」を押すと、業務の種類・番・業務表（従来型／ユニット）が入った状態でボードが開きます。名簿はあとから足せます。</p>
      </div>

      <section aria-labelledby="f1" className="rounded-xl border border-[var(--cn-border)] bg-white p-4">
        <h3 id="f1" className="mb-3 text-[16px] font-bold">
          1. 施設とグループ
        </h3>
        <label className={label} htmlFor="own-name">
          施設の名前（必須）
        </label>
        <input
          id="own-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={`${field} h-[44px]`}
          autoComplete="off"
          aria-required="true"
          aria-invalid={nameErr || undefined}
          aria-describedby={nameErr ? "own-name-err" : undefined}
        />
        {nameErr && (
          <p id="own-name-err" className="mt-1 font-bold text-[var(--cn-unassigned-ink)]">
            施設の名前を入れてください
          </p>
        )}
        <label className={`${label} mt-3`} htmlFor="own-groups">
          グループ（必須。1行に1つ。フロアやユニットの名前）
        </label>
        <textarea
          id="own-groups"
          value={groupsText}
          onChange={(e) => setGroupsText(e.target.value)}
          rows={3}
          className={field}
          placeholder={"例: 2階\n例: あおばユニット"}
          aria-required="true"
          aria-invalid={groupErr || undefined}
          aria-describedby={`own-groups-help${groupErr ? " own-groups-err" : ""}`}
        />
        {groupErr && (
          <p id="own-groups-err" className="mt-1 font-bold text-[var(--cn-unassigned-ink)]">
            グループを1つ以上入れてください（1行に1つ）
          </p>
        )}
        <div id="own-groups-help" className="mt-1 text-[14px] text-[var(--cn-ink-soft)]">
          <p>「共通」は自動で足します。名前に「ユニット」があればユニットの業務表、ほかはフロア（従来型）の業務表を当てはめます。</p>
          {result.mapping.length > 0 && (
            <ul className="mt-1">
              {result.mapping.map((m) => (
                <li key={m.group}>
                  {m.group} → {m.kind}の業務表
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section aria-labelledby="f2" className="rounded-xl border border-[var(--cn-border)] bg-white p-4">
        <h3 id="f2" className="mb-1 text-[16px] font-bold">
          2. 利用者を貼り付け
        </h3>
        <p id="f2-help" className="mb-2 text-[14px] text-[var(--cn-ink-soft)]">
          1行に1人「名前, グループ, 部屋」の順。表計算ソフトからそのまま貼れます（カンマ・タブ）。姓と名の間は空白で区切ってください。
        </p>
        <textarea aria-labelledby="f2" aria-describedby="f2-help" value={residentsText} onChange={(e) => setResidentsText(e.target.value)} rows={5} className={field} placeholder="例: 菅野 ハル, 2階, 201" />
        <PasteNote count={result.counts.residents} unit="人" errors={result.residentErrors} />
      </section>

      <section aria-labelledby="f3" className="rounded-xl border border-[var(--cn-border)] bg-white p-4">
        <h3 id="f3" className="mb-1 text-[16px] font-bold">
          3. 職員を貼り付け
        </h3>
        <div id="f3-help" className="mb-2 text-[14px] text-[var(--cn-ink-soft)]">
          <p>1行に1人「名前, 職種, 担当条件（任意。・で区切る）, PHS（任意）」の順。見出しの行（氏名, 職種）は飛ばします。</p>
          <p>業務の種類が使う担当条件: {tags.join("・")}。単発で来る方は、職種を「スポット」にすると初回の印が付きます。</p>
        </div>
        <textarea aria-labelledby="f3" aria-describedby="f3-help" value={staffText} onChange={(e) => setStaffText(e.target.value)} rows={5} className={field} placeholder="例: 野村 ミホ, 介護福祉士, 入浴担当可, 811" />
        <PasteNote count={result.counts.staff} unit="人" errors={result.staffErrors} />
      </section>

      {result.noSpace > 0 && (
        <p className="rounded-xl border border-[var(--cn-control-line)] bg-white p-3">
          姓と名の間に空白がない行が {result.noSpace} 件あります。取り込みますが、手元画面で姓だけを出せません（あとから直せます）。
        </p>
      )}
      {result.skippedPersonal.length > 0 && (
        <p className="text-[14px] text-[var(--cn-ink-soft)]">
          雛形のうち、対象の方を決めていた業務（{result.skippedPersonal.join("・")}）は入れません。利用者の画面の24時間シートから足せます。業務の種類の相談先・物品の場所も空にしています（困ったらは「いまのリーダー」が出ます）。
        </p>
      )}
      {tried > 0 && result.problems.length > 0 && (
        <div key={tried} role="alert" className="rounded-xl border-2 border-[var(--cn-alert-line)] bg-white p-3">
          {result.problems.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
      )}

      <p className="text-[15px]">
        グループ {result.counts.groups}・利用者 {result.counts.residents}人・職員 {result.counts.staff}人を登録します。登録したら、ボードで今日来る人と番を選びます。
        <span className="font-bold">
          {isSample ? "いまのサンプル施設の内容は、このブラウザから消えます（設定の「はじめから」→「サンプル施設で試す」でいつでも戻せます）。" : "いまの施設の内容は、このブラウザから消えます。"}
        </span>
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="h-[52px] rounded-xl bg-[var(--cn-accent)] px-6 text-[17px] font-bold text-white">
          登録する
        </button>
        <button type="button" onClick={onCancel} className="h-[44px] rounded-lg border border-[var(--cn-control-line)] bg-white px-4">
          戻る（入れた内容は消えます）
        </button>
      </div>
    </form>
  );
}

function PasteNote({ count, unit, errors }: { count: number; unit: string; errors: { line: number; reason: string }[] }) {
  return (
    <div className="mt-1.5 text-[14px]">
      <p>
        取り込める行: {count}
        {unit}
      </p>
      {errors.length > 0 && (
        <ul aria-live="polite" className="mt-1 rounded-lg border border-[var(--cn-alert-line)] bg-[var(--cn-unassigned-bg)] p-2 text-[var(--cn-unassigned-ink)]">
          {errors.map((e) => (
            <li key={e.line}>
              {e.line}行目: {e.reason}（この行は取り込みません）
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ふだんの設定（2項目と施設コード）
// ---------------------------------------------------------------------------

function Everyday({ onOwn, onSample }: { onOwn: () => void; onSample: () => void }) {
  const { state } = useAppState();
  const engine = useEngine();
  const lastUndo = useSyncExternalStore(
    (cb) => (engine ? engine.subscribe(cb) : () => {}),
    () => engine?.lastUndo ?? null,
    () => null,
  );
  const [toast, setToast] = useState<string | null>(null);
  const [staffText, setStaffText] = useState("");
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 8000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const undo = async () => {
    const done = await engine?.undo();
    if (done) setToast(`戻しました（${done.label}）`);
  };
  const f = state.facility;
  if (!f) return null;
  const settings = f.settings;
  const example = Object.values(state.residents).sort((a, b) => a.room.localeCompare(b.room, "ja", { numeric: true }))[0];
  const modes: { mode: ResidentDisplayMode; label: string }[] = [
    { mode: "full", label: "フルネーム" },
    { mode: "roomAndSurname", label: "部屋番号＋姓" },
    { mode: "roomOnly", label: "部屋番号" },
  ];

  const set = async (patch: Parameters<typeof settingsEvent>[1], label: string) => {
    if (!engine) return;
    const ev = settingsEvent(engine.state, patch, engine.context());
    if (!ev) return;
    await engine.dispatch([ev], label);
    setToast(label);
  };

  const staffPaste = parseStaffPaste(state, staffText);
  const addStaff = async () => {
    if (!engine || staffPaste.staff.length === 0) return;
    const label = `職員 ${staffPaste.staff.length}人を足しました（今日来るなら、ボードの「今日来る人を足す」から）`;
    await engine.dispatch(staffEvents(staffPaste.staff, engine.context()), label);
    setStaffText("");
    setToast(label);
  };

  const choice = (on: boolean) =>
    `inline-flex h-[44px] items-center rounded-lg border px-4 text-[15px] ${on ? "border-2 border-[var(--cn-accent)] bg-[var(--cn-accent-soft)] font-bold text-[var(--cn-accent)]" : "border-[var(--cn-control-line)] bg-white"}`;

  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-[22px] font-bold">設定</h2>
        <span className="text-[15px] text-[var(--cn-ink-soft)]">{f.name}</span>
        <span className="ml-auto flex items-center gap-2">
          <button type="button" disabled={!lastUndo} onClick={undo} className="h-[44px] rounded-lg border border-[var(--cn-control-line)] bg-white px-4 font-bold disabled:text-[var(--cn-muted)]">
            元に戻す
          </button>
          <span className="text-[14px] text-[var(--cn-ink-soft)]">{lastUndo ? `（${lastUndo.label}）` : "（戻せる操作はありません）"}</span>
        </span>
      </div>

      <section aria-labelledby="s-code" className="rounded-xl border border-[var(--cn-border)] bg-white p-4">
        <h3 id="s-code" className="mb-1 text-[16px] font-bold">
          施設コード
        </h3>
        <p className="text-[28px] font-bold tracking-[0.2em] tabular-nums">{facilityCode(f.id)}</p>
        <p className="text-[14px] text-[var(--cn-ink-soft)]">
          この版の保存は、このブラウザの中だけです（同じブラウザの別のタブにはすぐ反映されます）。スマホなど別の端末で同じ時間割を見る同期と、認証・権限は、本番の要件として README に書いています。施設コードは認証ではありません。
        </p>
      </section>

      <section aria-labelledby="s-name" className="rounded-xl border border-[var(--cn-border)] bg-white p-4">
        <h3 id="s-name" className="mb-1 text-[16px] font-bold">
          手元画面（自分の予定）の利用者名
        </h3>
        <p className="mb-2 text-[14px] text-[var(--cn-ink-soft)]">スマホの画面での出し方です。ボード（施設の PC）は、いつもフルネームで出します。</p>
        <div role="group" aria-labelledby="s-name" className="flex flex-wrap gap-2">
          {modes.map((m) => (
            <button
              key={m.mode}
              type="button"
              aria-pressed={settings.residentDisplayMode === m.mode}
              onClick={() => set({ residentDisplayMode: m.mode }, `手元画面の利用者名を「${m.label}」にしました`)}
              className={choice(settings.residentDisplayMode === m.mode)}
            >
              {m.label}
              {example && <span className="ml-1.5 text-[14px] font-normal">（例: {residentLabel(example, m.mode)}様）</span>}
            </button>
          ))}
        </div>
      </section>

      <section aria-labelledby="s-first" className="rounded-xl border border-[var(--cn-border)] bg-white p-4">
        <h3 id="s-first" className="mb-1 text-[16px] font-bold">
          初回の職員の警告
        </h3>
        <p className="mb-2 text-[14px] text-[var(--cn-ink-soft)]">
          応援・スポットで初めて来た職員（ボードで「初回」の印が付く人）だけが担当になる枠に、「初回の方だけの配置になります」と注意を出します（止めません）。
        </p>
        <div role="group" aria-labelledby="s-first" className="flex flex-wrap gap-2">
          <button type="button" aria-pressed={settings.firstTimerOnlyWarning} onClick={() => set({ firstTimerOnlyWarning: true }, "初回の職員の警告を「する」にしました")} className={choice(settings.firstTimerOnlyWarning)}>
            する
          </button>
          <button type="button" aria-pressed={!settings.firstTimerOnlyWarning} onClick={() => set({ firstTimerOnlyWarning: false }, "初回の職員の警告を「しない」にしました")} className={choice(!settings.firstTimerOnlyWarning)}>
            しない
          </button>
        </div>
      </section>

      <section aria-labelledby="s-paste" className="rounded-xl border border-[var(--cn-border)] bg-white p-4">
        <h3 id="s-paste" className="mb-1 text-[16px] font-bold">
          名簿の貼り付け
        </h3>
        <p className="mb-2 text-[14px] text-[var(--cn-ink-soft)]">
          職員: 1行に1人「名前, 職種, 担当条件（任意）, PHS（任意）」。利用者は
          <Link href="/residents" className="mx-1 inline-flex min-h-[44px] items-center px-1 font-bold text-[var(--cn-accent)] underline">
            利用者
          </Link>
          の画面の「名簿を貼り付け」から足せます。
        </p>
        <label htmlFor="s-staff" className="mb-1 block font-bold">
          職員の貼り付け
        </label>
        <textarea id="s-staff" value={staffText} onChange={(e) => setStaffText(e.target.value)} rows={4} className="w-full rounded-lg border border-[var(--cn-control-line)] p-2.5 placeholder:text-[var(--cn-muted)]" placeholder="例: 野村 ミホ, 介護福祉士, 入浴担当可, 811" />
        <PasteNote count={staffPaste.staff.length} unit="人" errors={staffPaste.errors} />
        <button type="button" disabled={staffPaste.staff.length === 0} onClick={addStaff} className="mt-2 h-[44px] rounded-lg bg-[var(--cn-accent)] px-4 font-bold text-white disabled:bg-[var(--cn-muted)]">
          職員を足す
        </button>
      </section>

      <section aria-labelledby="s-start" className="rounded-xl border border-dashed border-[var(--cn-control-line)] p-4">
        <h3 id="s-start" className="mb-2 text-[16px] font-bold">
          はじめから
        </h3>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onSample} className="h-[44px] rounded-lg border border-[var(--cn-control-line)] bg-white px-4">
            サンプル施設で試す
          </button>
          <button type="button" onClick={onOwn} className="h-[44px] rounded-lg border border-[var(--cn-control-line)] bg-white px-4">
            自分の施設で始める
          </button>
        </div>
      </section>

      <div className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2">
        {toast && (
          <span className="flex items-center gap-3 rounded-xl bg-[var(--cn-ink)] px-4 py-2 text-[15px] text-white shadow-lg">
            <span role="status">{toast}</span>
            {lastUndo && !toast.startsWith("戻しました") && (
              <button type="button" onClick={undo} className="h-[44px] rounded-lg border border-white px-3 font-bold">
                元に戻す
              </button>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
