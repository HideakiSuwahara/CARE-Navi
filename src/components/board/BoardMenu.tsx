"use client";

import { useEffect, useRef, useState } from "react";
import { metaOf, patternFromDay } from "@/domain/pattern";
import type { State } from "@/domain/types";
import type { Engine } from "@/store/engine";
import { sampleEvents } from "@/store/sample";

/**
 * ボードの「⋯」メニュー（docs/screens.md §1 ツールバー）。
 * 分担表を印刷 ／ 今日を業務表として保存 ／ サンプルに戻す（サンプル施設のときだけ）。
 */
export function BoardMenu({
  state,
  engine,
  date,
  dateShort,
  onPrint,
  onNotice,
}: {
  state: State;
  engine: Engine | null;
  date: string;
  /** 「11/3」 */
  dateShort: string;
  onPrint: () => void;
  onNotice: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<"save" | "reset" | null>(null);
  const [name, setName] = useState("");
  const wrap = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const firstItem = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  // 同期中は「サンプルに戻す」を出さない（遠くの保存は消せない。戻すなら設定の「はじめから → サンプル施設で試す」）
  const isSample = state.facility?.id === "fac-himawari" && engine?.storeKind !== "sync";

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        toggle.current?.focus();
      }
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // 開いたら最初の項目へ
  useEffect(() => {
    if (open) firstItem.current?.focus();
  }, [open]);

  // 確認はネイティブの <dialog>（showModal: 背景を操作できなくし、Esc で閉じ、フォーカスを中に閉じ込める）
  useEffect(() => {
    const d = dialogRef.current;
    if (dialog && d && !d.open) d.showModal();
  }, [dialog]);

  const closeDialog = () => {
    dialogRef.current?.close();
  };
  // <dialog> が閉じたとき（Esc・やめる・保存）: 状態を戻し、⋯ へフォーカスを返す
  const onDialogClose = () => {
    setDialog(null);
    toggle.current?.focus();
  };

  const save = async () => {
    if (!engine) return;
    const label = name.trim() || `${dateShort}の業務表`;
    const ctx = engine.context();
    const pattern = patternFromDay(engine.state, date, label, ctx);
    if (!pattern) {
      onNotice("保存できる業務がありません。");
      closeDialog();
      return;
    }
    await engine.dispatch([{ ...metaOf(ctx), type: "pattern.upsert", pattern }], `業務表「${label}」を保存しました`);
    closeDialog();
  };

  const reset = async () => {
    if (!engine) return;
    await engine.reset(sampleEvents());
    closeDialog();
    onNotice("サンプルの状態に戻しました。");
  };

  const item = "flex min-h-[44px] w-full items-center px-4 text-left text-[15px] hover:bg-[var(--cn-ground)]";

  return (
    <div ref={wrap} className="relative">
      <button
        ref={toggle}
        type="button"
        aria-expanded={open}
        aria-controls="board-menu"
        aria-label="ほかの操作"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-[44px] w-[44px] items-center justify-center rounded-lg border border-[var(--cn-card-line)] bg-white text-[18px] font-bold"
      >
        ⋯
      </button>
      {open && (
        <div
          id="board-menu"
          onBlur={(e) => {
            if (!wrap.current?.contains(e.relatedTarget as Node)) setOpen(false);
          }}
          className="absolute right-0 top-[48px] z-30 w-[260px] overflow-hidden rounded-xl border border-[var(--cn-border)] bg-white py-1 shadow-lg">
          <button
            ref={firstItem}
            type="button"
            className={item}
            onClick={() => {
              setOpen(false);
              onPrint();
            }}
          >
            分担表を印刷
          </button>
          <button
            type="button"
            className={item}
            onClick={() => {
              setOpen(false);
              setName(`${dateShort}の業務表`);
              setDialog("save");
            }}
          >
            今日を業務表として保存
          </button>
          {isSample && (
            <button
              type="button"
              className={item}
              onClick={() => {
                setOpen(false);
                setDialog("reset");
              }}
            >
              サンプルに戻す
            </button>
          )}
        </div>
      )}

      {dialog && (
        <dialog
          ref={dialogRef}
          aria-labelledby="board-menu-dialog-title"
          onClose={onDialogClose}
          // 外側（::backdrop）を押したら閉じる
          onClick={(e) => e.target === e.currentTarget && closeDialog()}
          className="m-auto w-[440px] rounded-xl bg-white p-0 shadow-xl backdrop:bg-black/30"
        >
          <div className="p-5">
            {dialog === "save" ? (
              <>
                <h2 id="board-menu-dialog-title" className="text-[17px] font-bold">
                  今日を業務表として保存
                </h2>
                <p className="mt-2 text-[15px] text-[var(--cn-ink-soft)]">業務・時刻・番・必要人数・対象の方を保存します。担当の人は保存しません。業務の種類のない、その日だけの予定も入りません。次に時間割を作るときに選べます。</p>
                <label className="mt-4 block text-[14px] font-bold" htmlFor="pattern-name">
                  業務表の名前
                </label>
                <input
                  id="pattern-name"
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && save()}
                  className="mt-1 h-[44px] w-full rounded-lg border border-[var(--cn-control-line)] px-3 text-[15px]"
                />
                <div className="mt-5 flex justify-end gap-2">
                  <button type="button" onClick={closeDialog} className="h-[44px] rounded-lg border border-[var(--cn-control-line)] px-4">
                    やめる
                  </button>
                  <button type="button" onClick={save} className="h-[44px] rounded-lg bg-[var(--cn-accent)] px-4 font-bold text-white">
                    この内容で保存
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 id="board-menu-dialog-title" className="text-[17px] font-bold">
                  サンプルに戻しますか
                </h2>
                <p className="mt-2 text-[15px] text-[var(--cn-ink-soft)]">これまでの変更はすべて消え、元に戻せません。サンプル施設を最初の状態から試せます。</p>
                <div className="mt-5 flex justify-end gap-2">
                  <button type="button" autoFocus onClick={closeDialog} className="h-[44px] rounded-lg border border-[var(--cn-control-line)] px-4">
                    やめる
                  </button>
                  <button type="button" onClick={reset} className="h-[44px] rounded-lg border-2 border-[var(--cn-alert-line)] px-4 font-bold">
                    サンプルに戻す
                  </button>
                </div>
              </>
            )}
          </div>
        </dialog>
      )}
    </div>
  );
}
