"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useAppState, useEngine } from "@/store/react";
import { TopBar } from "@/components/TopBar";
import type { ID } from "@/domain/types";
import { RoutineGrid } from "./RoutineGrid";
import { SheetView } from "./SheetView";
import { PastePanel } from "./PastePanel";

type Tab = "grid" | "sheet";

/**
 * 利用者（PC）: 施設の日課と、利用者ごとの24時間シート（決定記録 0004）。
 * ［一覧｜24時間シート］は同じデータの見え方の違い。直した時刻は、次に時間割を作るときから入る。
 */
export function Residents() {
  const { state, ready } = useAppState();
  const engine = useEngine();
  const lastUndo = useSyncExternalStore(
    (cb) => (engine ? engine.subscribe(cb) : () => {}),
    () => engine?.lastUndo ?? null,
    () => null,
  );
  const [tab, setTab] = useState<Tab>("grid");
  const [pickedGroup, setPickedGroup] = useState<ID | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  // 貼り付けで足した方（一覧でその行までスクロールし、2秒ほど目立たせる）
  const [flash, setFlash] = useState<ID[]>([]);
  useEffect(() => {
    if (flash.length === 0) return;
    const id = window.setTimeout(() => setFlash([]), 2500);
    return () => window.clearTimeout(id);
  }, [flash]);

  const groups = useMemo(
    () =>
      Object.values(state.groups)
        .filter((g) => g.kind !== "common" || Object.values(state.residents).some((r) => r.groupId === g.id))
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [state.groups, state.residents],
  );
  const groupId = pickedGroup && state.groups[pickedGroup] ? pickedGroup : groups[0]?.id;
  const hasResidents = Object.keys(state.residents).length > 0;

  // 操作のあとのお知らせ（トースト）。8秒で消えるが「元に戻す」はツールバーに残る
  const [toast, setToast] = useState<string | null>(null);
  const lastKey = lastUndo ? lastUndo.batchId : "";
  const seen = useRef(new Set<string>());
  useEffect(() => {
    // 元に戻したあとに1つ前の操作の文を出し直さない（新しい操作のときだけ出す）
    if (!lastUndo || seen.current.has(lastUndo.batchId)) return;
    seen.current.add(lastUndo.batchId);
    setToast(lastUndo.label);
    const id = window.setTimeout(() => setToast(null), 8000);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastKey]);

  const afterPaste = (g: ID, ids: ID[]) => {
    setPasteOpen(false);
    setPickedGroup(g);
    setTab("grid");
    setFlash(ids);
  };

  const seg = (on: boolean) =>
    `inline-flex h-[44px] items-center px-4 text-[15px] ${on ? "bg-[var(--cn-accent)] font-bold text-white" : "bg-white text-[var(--cn-ink)]"}`;

  return (
    <div className="flex h-screen flex-col print:block print:h-auto">
      <TopBar current="residents" />

      <div className="cn-noprint shrink-0 px-5 pt-3">
        <h1 className="text-[20px] font-bold">利用者の日課</h1>
        <p className="mt-0.5 text-[15px]">施設の日課と、方ごとの時刻・サポートを決めます。次に時間割を作るときから入ります。</p>
      </div>

      {ready && hasResidents && (
        <div className="cn-noprint flex shrink-0 flex-wrap items-center gap-3 px-5 py-2.5">
          <div role="group" aria-label="見え方" className="inline-flex overflow-hidden rounded-lg border border-[var(--cn-control-line)]">
            <button type="button" aria-pressed={tab === "grid"} onClick={() => setTab("grid")} className={seg(tab === "grid")}>
              一覧
            </button>
            <button
              type="button"
              aria-pressed={tab === "sheet"}
              onClick={() => setTab("sheet")}
              className={`${seg(tab === "sheet")} border-l border-[var(--cn-control-line)]`}
            >
              24時間シート
            </button>
          </div>
          <div role="group" aria-label="グループ" className="inline-flex overflow-hidden rounded-lg border border-[var(--cn-control-line)]">
            {groups.map((g, i) => (
              <button
                key={g.id}
                type="button"
                aria-pressed={g.id === groupId}
                onClick={() => setPickedGroup(g.id)}
                className={`${seg(g.id === groupId)} ${i > 0 ? "border-l border-[var(--cn-control-line)]" : ""}`}
              >
                {g.name}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {lastUndo && (
              <button
                type="button"
                onClick={() => {
                  setToast(null);
                  void engine?.undo();
                }}
                className="inline-flex h-[44px] items-center gap-2 rounded-lg border border-[var(--cn-card-line)] bg-white px-4 text-[14px]"
              >
                元に戻す<span className="text-[13px] text-[var(--cn-muted)]">（{lastUndo.label}）</span>
              </button>
            )}
            <button
              type="button"
              aria-expanded={pasteOpen}
              onClick={() => setPasteOpen((v) => !v)}
              className="inline-flex h-[44px] items-center rounded-lg border border-[var(--cn-control-line)] bg-white px-4 text-[15px]"
            >
              名簿を貼り付ける
            </button>
          </div>
        </div>
      )}

      <main className="flex min-h-0 flex-1 flex-col gap-3 px-5 pb-5 print:block print:p-0">
        {!ready ? (
          <div className="p-6 text-[var(--cn-muted)]">読み込んでいます…</div>
        ) : !hasResidents ? (
          <div className="flex flex-col items-start gap-4 rounded-xl border border-[var(--cn-border)] bg-white p-6">
            <p className="text-[17px] font-bold">利用者がまだいません</p>
            <p className="text-[var(--cn-ink-soft)]">名簿を貼り付けると、全員に施設の日課が標準どおりに入ります。違う方だけ、あとで直せます。</p>
            {pasteOpen ? (
              <div className="w-full max-w-[720px]">
                <PastePanel state={state} groupId={groupId} onClose={() => setPasteOpen(false)} onAdded={afterPaste} />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setPasteOpen(true)}
                className="inline-flex h-[44px] items-center rounded-lg bg-[var(--cn-accent)] px-5 font-bold text-white"
              >
                名簿を貼り付ける
              </button>
            )}
          </div>
        ) : (
          <>
            {pasteOpen && <PastePanel state={state} groupId={groupId} onClose={() => setPasteOpen(false)} onAdded={afterPaste} />}
            {groupId && (tab === "grid" ? <RoutineGrid key={groupId} state={state} groupId={groupId} flash={flash} /> : <SheetView key={groupId} state={state} groupId={groupId} />)}
          </>
        )}
      </main>

      <div role="status" aria-live="polite" className="cn-noprint pointer-events-none fixed bottom-5 left-1/2 z-40 -translate-x-1/2">
        {toast && (
          <div className="pointer-events-auto flex items-center gap-3 rounded-[10px] bg-[var(--cn-ink)] px-4 py-3 text-[15px] text-white shadow-lg">
            <span>{toast}</span>
            <button
              type="button"
              onClick={() => {
                setToast(null);
                engine?.undo();
              }}
              className="h-[44px] rounded-md border border-white/40 px-3 text-[14px] font-bold"
            >
              元に戻す
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
