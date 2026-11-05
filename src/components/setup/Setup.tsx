"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { TopBar } from "@/components/TopBar";
import { residentLabel } from "@/domain/display";
import { himawariSeed } from "@/domain/seed";
import { buildOwnFacility, conditionTags, parseStaffPaste, setStaffTagEvents, settingsEvent, staffEvents, staffTagLabel, usedByTemplates } from "@/domain/setup";
import type { ResidentDisplayMode } from "@/domain/types";
import { useAppState, useEngine, useSyncStatus } from "@/store/react";
import { SETUP_NOTE_KEY } from "./setupNote";
import { sampleEvents } from "@/store/sample";
import { LocalStore } from "@/store/datastore";
import { supabaseEnv, supabaseSyncClient } from "@/store/supabaseClient";
import { joinUrl, newFacilityCode, normalizeCode, readSyncCode, writeSyncCode } from "@/store/syncJoin";
import { SyncBadge } from "@/components/SyncBadge";
import type { Event } from "@/domain/events";

/**
 * 同期をやめて、ブラウザ内保存を events で作り直し、画面を読み込み直す（Engine を作り直す）。
 * 「サンプル施設で試す」「自分の施設で始める」は、同期中の施設へ送らない。
 */
async function resetLocalAndReload(events: Event[], to: string) {
  writeSyncCode(null);
  const local = new LocalStore();
  await local.clear();
  await local.append(events);
  window.location.assign(to);
}

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

export function Setup({ join }: { join?: string }) {
  const { state, ready, loaded } = useAppState();
  const engine = useEngine();
  const router = useRouter();
  const sync = useSyncStatus();
  const [chosen, setChosen] = useState<boolean | null>(null);
  const [own, setOwn] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  useEffect(() => setChosen(readChosen()), []);
  // QR や URL から来た「施設コードで参加」（/setup?join=コード）
  const [joinNote, setJoinNote] = useState<string | null>(null);
  useEffect(() => {
    if (!join) return;
    const code = normalizeCode(join);
    if (!supabaseEnv()) {
      setJoinNote("この版では施設コードで参加できません（同期の設定がありません）。");
      return;
    }
    if (code === readSyncCode()) {
      setJoinNote("すでにこの施設コードで同期しています。");
      return;
    }
    if (code) {
      writeSyncCode(code);
      writeChosen(true);
      writeSetupNote(`施設コード ${spaced(code)} で参加しました。`);
      window.location.replace(window.innerWidth < 768 ? "/me" : "/board");
    }
  }, [join]);

  if (chosen === null || (!loaded && !ready)) return <p className="p-6 text-[15px] text-[var(--cn-muted)]">読み込んでいます…</p>;

  const trySample = async () => {
    writeChosen(true);
    if (sync.kind === "sync") {
      await resetLocalAndReload(sampleEvents(), "/board");
      return;
    }
    if (engine && state.facility?.id !== himawariSeed.facility.id) await engine.reset(sampleEvents());
    router.push("/board");
  };

  if (own) {
    return (
      <Shell>
        <OwnFacilityForm
          onCancel={() => setOwn(false)}
          isSample={state.facility?.id === himawariSeed.facility.id}
          onDone={async (events, r) => {
            if (!engine) return;
            if (sync.kind === "sync") {
              // 同期中の施設の内容を上書きしない。この端末をブラウザ内保存に戻して作る
              writeChosen(true);
              await resetLocalAndReload(events, "/board");
              return;
            }
            await engine.reset(events);
            const residentErrors = r.residentErrors.length;
            const staffErrors = r.staffErrors.length;
            try {
              window.sessionStorage.setItem(
                SETUP_NOTE_KEY,
                JSON.stringify({
                  text: `登録しました（グループ ${r.counts.groups}・利用者 ${r.counts.residents}人・職員 ${r.counts.staff}人）。${
                    residentErrors + staffErrors > 0 ? `取り込めなかった行: 利用者 ${residentErrors}・職員 ${staffErrors}。` : ""
                  }`,
                  residentErrors,
                  staffErrors,
                }),
              );
            } catch {
              // 保存できない端末では知らせを出さない
            }
            writeChosen(true);
            router.push("/board");
          }}
        />
      </Shell>
    );
  }

  if (!chosen && !(sync.kind === "sync" && loaded)) {
    return (
      <Shell>
        <section aria-labelledby="start-title" className="mx-auto flex max-w-[640px] flex-col gap-5 pt-10">
          <h2 id="start-title" className="text-[22px] font-bold">
            はじめに
          </h2>
          {joinNote && (
            <p role="alert" className="rounded-xl border-2 border-[var(--cn-alert-line)] bg-white p-3 text-[15px]">
              {joinNote}
            </p>
          )}
          <p className="text-[16px]">入力なしで、架空の施設（ひまわり苑）の一日を触れます。自分の施設は、名簿を貼り付けて始められます。</p>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={trySample} className="h-[56px] rounded-xl bg-[var(--cn-accent)] px-6 text-[17px] font-bold text-white">
              サンプル施設で試す
            </button>
            <button type="button" onClick={() => setOwn(true)} className="h-[56px] rounded-xl border-2 border-[var(--cn-control-line)] bg-white px-6 text-[17px] font-bold">
              自分の施設で始める
            </button>
            {supabaseEnv() && (
              <button
                type="button"
                aria-expanded={joinOpen}
                onClick={() => setJoinOpen((v) => !v)}
                className="h-[56px] rounded-xl border-2 border-[var(--cn-control-line)] bg-white px-6 text-[17px] font-bold"
              >
                施設コードで参加
              </button>
            )}
          </div>
          {joinOpen && (
            <div className="rounded-xl border border-[var(--cn-border)] bg-white p-4">
              <p className="mb-2 text-[15px] text-[var(--cn-ink-soft)]">施設の PC（設定）で発行した 6 文字のコードを入れると、同じ時間割を見られます。QR を読んだ場合は自動で入ります。</p>
              <JoinForm label="施設コード" autoFocus />
            </div>
          )}
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

function OwnFacilityForm({ onCancel, onDone, isSample }: { onCancel: () => void; onDone: (events: ReturnType<typeof buildOwnFacility>["events"], result: ReturnType<typeof buildOwnFacility>) => void; isSample: boolean }) {
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
        if (result.ok) onDone(result.events, result);
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
  // 職員の担当条件: 「ほかの条件を足す」の入力と、まだ誰にも付いていない追加の条件
  const [newTag, setNewTag] = useState("");
  const [extraTags, setExtraTags] = useState<string[]>([]);
  useEffect(() => {
    const note = readSetupNote();
    if (note) setToast(note);
    document.getElementById("setup-title")?.focus();
  }, []);
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
  if (!f) {
    // 同期で参加したが、その施設コードにまだ内容がない（コードの打ち間違いなど）
    return (
      <div className="mx-auto flex w-full max-w-[880px] flex-col gap-4">
        <h2 id="setup-title" tabIndex={-1} className="text-[22px] font-bold outline-none">
          設定
        </h2>
        <SyncEmpty />
      </div>
    );
  }
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

  // 職員の担当条件（付ける／外す。1 タップ、元に戻せる）
  const tags = [...conditionTags(state), ...extraTags.filter((t) => !conditionTags(state).includes(t))];
  const staffRows = Object.values(state.staff).sort((a, b) => a.surname.localeCompare(b.surname, "ja"));
  const toggleTag = async (staffId: string, tag: string, on: boolean) => {
    if (!engine) return;
    const evs = setStaffTagEvents(engine.state, staffId, tag, on, engine.context());
    if (evs.length === 0) return;
    const label = staffTagLabel(engine.state, staffId, tag, on);
    await engine.dispatch(evs, label);
    setToast(label);
  };
  const addTag = () => {
    const t = newTag.trim();
    if (!t || tags.includes(t)) {
      setNewTag("");
      return;
    }
    setExtraTags((prev) => [...prev, t]);
    setNewTag("");
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
        <h2 id="setup-title" tabIndex={-1} className="text-[22px] font-bold outline-none">
          設定
        </h2>
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
          ほかの端末からも見る（施設コード）
        </h3>
        <SyncSection facilityName={f.name} />
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

      <section aria-labelledby="s-tags" className="rounded-xl border border-[var(--cn-border)] bg-white p-4">
        <h3 id="s-tags" className="mb-1 text-[16px] font-bold">
          職員の担当条件
        </h3>
        <p className="mb-2 text-[14px] text-[var(--cn-ink-soft)]">
          業務の種類が条件にしているもの（{tags.filter((t) => usedByTemplates(state, t)).join("・") || "なし"}）を、その人が持っているかどうか。条件を満たさない人も担当にできます（「注意」として理由が出ます）。等級や評価ではありません。
        </p>
        {staffRows.length === 0 ? (
          <p className="text-[15px]">職員がまだいません。下の「名簿の貼り付け」から足せます。</p>
        ) : (
          <ul aria-label="職員ごとの担当条件" className="flex flex-col divide-y divide-[var(--cn-grid)]">
            {staffRows.map((st) => (
              <li key={st.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="w-[140px] shrink-0">
                  <span className="font-bold">{st.surname}</span>
                  <span className="ml-1 text-[14px] text-[var(--cn-ink-soft)]">{st.role}</span>
                </span>
                <span className="flex flex-wrap gap-1.5">
                  {tags.map((t) => {
                    const on = st.tags.includes(t);
                    return (
                      <button
                        key={t}
                        type="button"
                        aria-pressed={on}
                        aria-label={`${st.surname}さん: ${t}`}
                        onClick={() => toggleTag(st.id, t, !on)}
                        className={`inline-flex h-[44px] items-center gap-1 rounded-lg border px-3 text-[15px] ${
                          on ? "border-2 border-[var(--cn-accent)] bg-[var(--cn-accent-soft)] font-bold text-[var(--cn-accent)]" : "border-[var(--cn-control-line)] bg-white text-[var(--cn-ink)]"
                        }`}
                      >
                        <span aria-hidden="true">{on ? "✓" : "□"}</span>
                        {t}
                      </button>
                    );
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            addTag();
          }}
        >
          <label className="flex flex-col gap-1 text-[14px]">
            <span>ほかの条件を足す（例: 喀痰吸引）</span>
            <input value={newTag} onChange={(e) => setNewTag(e.target.value)} className="h-[44px] w-[220px] rounded-lg border border-[var(--cn-control-line)] px-2.5 text-[15px]" />
          </label>
          <button type="submit" disabled={!newTag.trim()} className="h-[44px] rounded-lg border border-[var(--cn-control-line)] bg-white px-4 text-[15px] font-bold disabled:text-[var(--cn-muted)]">
            条件を足す
          </button>
          <span className="text-[14px] text-[var(--cn-muted)]">足した条件は、誰かに付けると残ります。</span>
        </form>
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

// ---------------------------------------------------------------------------
// 施設コードと同期（決定記録 0009）
// ---------------------------------------------------------------------------

function SyncSection({ facilityName }: { facilityName: string }) {
  const sync = useSyncStatus();
  const available = supabaseEnv();
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [lastCode, setLastCode] = useState<string | null>(null);
  useEffect(() => {
    setCode(readSyncCode());
    try {
      setLastCode(window.localStorage.getItem("care-navi.last-sync-code"));
    } catch {
      // 読めなければ出さない
    }
  }, []);
  useEffect(() => {
    if (!code) {
      setQr(null);
      return;
    }
    let alive = true;
    import("qrcode")
      .then((m) => m.toDataURL(joinUrl(window.location.origin, code), { width: 192, margin: 1 }))
      .then((url) => alive && setQr(url))
      .catch(() => alive && setQr(null));
    return () => {
      alive = false;
    };
  }, [code]);

  const startSync = async () => {
    if (!available || busy) return;
    setBusy(true);
    setError(null);
    try {
      const events = await new LocalStore().load();
      // 発行のたびに違うコード（施設 ID から決めると、サンプル施設が全員同じコードになる）
      const newCode = newFacilityCode();
      await supabaseSyncClient(available).insert(newCode, events);
      writeSyncCode(newCode);
      writeSetupNote(`ほかの端末と同じ内容にする設定を始めました（施設コード ${spaced(newCode)}）。`);
      window.location.assign("/setup");
    } catch {
      setError("送れませんでした。接続を確かめて、もう一度押してください。");
      setBusy(false);
    }
  };
  const leave = async () => {
    if (!code || busy) return;
    setBusy(true);
    // いまの内容（同期で届いた分を含む）をこの端末だけの保存に写してから切る。施設コードの側はそのまま残る
    const cache = new LocalStore(`care-navi.sync.${code}.v1`);
    const events = await cache.load();
    const local = new LocalStore();
    await local.clear();
    await local.append(events);
    await cache.clear();
    try {
      window.localStorage.removeItem(`care-navi.pending.${code}`);
      window.localStorage.removeItem(`care-navi.undo.sync.${code}`);
    } catch {
      // 消せなくても動く
    }
    writeSyncCode(null);
    try {
      window.localStorage.setItem("care-navi.last-sync-code", code);
    } catch {
      // 覚えられなくてもよい
    }
    writeSetupNote("ほかの端末と同じ内容にするのをやめました。いまの内容はこの端末に残っています。ほかの端末の内容はそのままです。");
    window.location.assign("/setup");
  };
  const btn = "h-[44px] rounded-lg border border-[var(--cn-control-line)] bg-white px-4 text-[15px] font-bold text-[var(--cn-ink)]";

  if (!available) {
    return (
      <p className="text-[14px] text-[var(--cn-ink-soft)]">
        この版では、ほかの端末と同じ内容にすること（同期）は使えません。保存はこのブラウザの中だけです（同じブラウザの別のタブにはすぐ反映されます）。
      </p>
    );
  }

  if (sync.kind === "sync" && code) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[28px] font-bold tracking-[0.2em] tabular-nums">
          <span aria-hidden="true">{code}</span>
          <span className="sr-only">{spaced(code)}</span>
        </p>
        <p className="flex flex-wrap items-center gap-2 text-[15px]">
          <span>この施設コードで、ほかの端末と同じ内容にしています（{facilityName}）。</span>
          <SyncBadge />
        </p>
        <div className="flex flex-wrap items-start gap-4">
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} width={192} height={192} alt={`参加用の QR コード（施設コード ${spaced(code)}）`} className="rounded-lg border border-[var(--cn-border)]" />
          ) : (
            <div aria-hidden="true" className="h-[192px] w-[192px] rounded-lg border border-[var(--cn-border)] bg-[var(--cn-ground)]" />
          )}
          <div className="flex flex-col gap-2 text-[14px] text-[var(--cn-ink-soft)]">
            <p>ほかの端末（スマホなど）は、この QR を読むか、設定の「施設コードで参加」にこのコードを入れると、同じ時間割を見られます。</p>
            <p>QR はこの画面の URL を含みます。スマホから開ける URL（公開した URL）でこの画面を開いてから読んでください。</p>
            <p>
              施設コードは暗証番号ではありません。コードを知っている人は誰でも見て変えられます。辞めた人・応援が終わった人の端末では「この端末だけにする」を押してもらってください（コードを新しくすることは、この版ではできません）。
            </p>
            {!confirmLeave ? (
              <button type="button" onClick={() => setConfirmLeave(true)} className={`${btn} self-start`}>
                この端末だけにする（同期をやめる）
              </button>
            ) : (
              <div className="flex flex-col gap-2 rounded-xl border-2 border-[var(--cn-alert-line)] bg-white p-3 text-[15px] text-[var(--cn-ink)]">
                <p>やめると、この端末はいまの内容を持ったまま、ほかの端末と別々になります。ほかの端末の内容はそのまま残ります。</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={leave} aria-busy={busy} className="h-[44px] rounded-lg bg-[var(--cn-accent)] px-4 font-bold text-white">
                    やめる
                  </button>
                  <button type="button" onClick={() => setConfirmLeave(false)} className={btn}>
                    やめない
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        {error && (
          <p role="alert" className="rounded-lg border-2 border-[var(--cn-alert-line)] bg-white p-2 text-[15px]">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[15px]">このブラウザだけに保存しています。ほかの端末（スマホなど）からも同じ時間割を見るには、同期を始めてコードを渡します。</p>
      {lastCode && (
        <p className="text-[14px] text-[var(--cn-ink-soft)]">
          前に使っていた施設コード {lastCode} の端末とは別の、新しいコードを発行します（前のコードの端末どうしは、そのコードで続きます）。前の内容に合流したいときは、下の「参加」で前のコードを入れてください。
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={startSync}
          aria-disabled={busy}
          aria-busy={busy}
          className={`h-[44px] rounded-lg px-4 font-bold text-white ${busy ? "bg-[var(--cn-muted)]" : "bg-[var(--cn-accent)]"}`}
        >
          {busy ? "送っています…" : "この施設を同期する（ほかの端末から見られるようにする）"}
        </button>
      </div>
      <p className="text-[14px] text-[var(--cn-ink-soft)]">
        施設コードは暗証番号ではありません。この版では鍵が公開されるため、試用では架空の名簿だけを入れてください。実在の利用者・職員の名簿を入れた施設は、この版では同期しないでください。
      </p>
      <JoinForm label="ほかの端末で発行した施設コードで参加" />
      {error && (
        <p role="alert" className="rounded-lg border-2 border-[var(--cn-alert-line)] bg-white p-2 text-[15px]">
          {error}
        </p>
      )}
    </div>
  );
}

/** 施設コードを 1 文字ずつ読めるように（読み上げ用） */
function spaced(code: string): string {
  return code.split("").join(" ");
}

/** 「施設コードで参加」の入力と「参加する」。はじめの画面と、ふだんの設定の両方で使う */
function JoinForm({ label, autoFocus }: { label: string; autoFocus?: boolean }) {
  const [joinText, setJoinText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const joinByCode = () => {
    const c = normalizeCode(joinText);
    if (!/^[A-Z0-9]{4,12}$/.test(c)) {
      setError("施設コードは英数字 4〜12 文字です。");
      window.setTimeout(() => document.getElementById("s-join")?.focus(), 0);
      return;
    }
    if (c === readSyncCode()) {
      setError("すでにこの施設コードで同期しています。");
      return;
    }
    writeSyncCode(c);
    writeChosen(true);
    writeSetupNote(`施設コード ${spaced(c)} で参加しました。`);
    window.location.assign(window.innerWidth < 768 ? "/me" : "/board");
  };
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="s-join" className="font-bold">
        {label}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id="s-join"
          value={joinText}
          onChange={(e) => {
            setJoinText(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && joinByCode()}
          placeholder="例: ABC234"
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          maxLength={12}
          autoFocus={autoFocus}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "s-join-err" : undefined}
          className="h-[44px] w-[180px] rounded-lg border border-[var(--cn-control-line)] px-3 text-[16px] tracking-[0.15em] placeholder:text-[var(--cn-muted)]"
        />
        <button type="button" onClick={joinByCode} className="h-[44px] rounded-lg border border-[var(--cn-control-line)] bg-white px-4 text-[15px] font-bold">
          参加する
        </button>
      </div>
      {error && (
        <p id="s-join-err" role="alert" className="rounded-lg border-2 border-[var(--cn-alert-line)] bg-white p-2 text-[15px]">
          {error}
        </p>
      )}
    </div>
  );
}

const SETUP_TOAST_KEY = "cn-setup-toast";
function writeSetupNote(text: string) {
  try {
    window.sessionStorage.setItem(SETUP_TOAST_KEY, text);
  } catch {
    // 残せなければ出さない
  }
}
function readSetupNote(): string | null {
  try {
    const v = window.sessionStorage.getItem(SETUP_TOAST_KEY);
    if (v) window.sessionStorage.removeItem(SETUP_TOAST_KEY);
    return v;
  } catch {
    return null;
  }
}

/** 同期で参加したコードに、まだ内容がないときの案内（次の 1 手: この端末だけにする） */
export function SyncEmpty() {
  const leave = () => {
    writeSyncCode(null);
    window.location.assign("/setup");
  };
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border-2 border-[var(--cn-alert-line)] bg-white p-4 text-[16px]">
      <p>この施設コードの内容は届いていません。コードを確かめてください（施設の PC の設定に出ている 6 文字）。</p>
      <button type="button" onClick={leave} className="h-[48px] rounded-xl border border-[var(--cn-control-line)] bg-white px-4 font-bold">
        この端末だけにする（同期をやめる）
      </button>
    </div>
  );
}
