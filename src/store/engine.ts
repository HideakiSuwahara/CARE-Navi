/**
 * Engine: 画面が触る唯一の入口。
 * - state: イベント列から作った現在の状態
 * - dispatch(events): まとめて適用し、保存層へ追記し、履歴に積む（batchId 単位で元に戻せる）
 * - undo(): 直近のバッチを打ち消しイベントで戻す（打ち消し自体も保存・配信される）
 * - 他端末・他タブからのイベントは subscribe で受けて適用する（履歴には積まない）
 * React からは useSyncExternalStore で購読する。
 */

import type { Event } from "../domain/events.ts";
import { applyEvents, invertBatch } from "../domain/reducer.ts";
import type { EventContext } from "../domain/pattern.ts";
import { emptyState, type ID, type State } from "../domain/types.ts";
import type { DataStore, SyncStatus } from "./datastore.ts";

export interface HistoryItem {
  event: Event;
  before: State;
}

export interface UndoEntry {
  batchId: ID;
  /** トーストに出す文。例: 「山本さんを「入浴介助 10:30」に割り当てました」 */
  label: string;
  at: string;
}

/** 「元に戻す」の一覧を端末に残す（読み込み直しても戻せる）。保存は batchId と label だけ。打ち消しに要る状態は起動時にイベント列から作り直す */
export interface UndoLog {
  load(): UndoEntry[];
  save(entries: UndoEntry[]): void;
}

/** ブラウザの localStorage に残す UndoLog（保存層ごとに鍵を分ける） */
export function localUndoLog(key: string): UndoLog {
  return {
    load() {
      try {
        const raw = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
        const parsed = raw ? (JSON.parse(raw) as UndoEntry[]) : [];
        return Array.isArray(parsed) ? parsed.filter((u) => u && typeof u.batchId === "string" && typeof u.label === "string") : [];
      } catch {
        return [];
      }
    },
    save(entries) {
      try {
        if (typeof localStorage === "undefined") return;
        if (entries.length === 0) localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify(entries));
      } catch {
        // 残せなくても、このタブでは戻せる
      }
    },
  };
}

export interface EngineOptions {
  store: DataStore;
  newId?: () => ID;
  now?: () => Date;
  actorId?: ID;
  /** 戻せる手数 */
  historyLimit?: number;
  /** 「元に戻す」の一覧を残す場所（省略ならメモリだけ） */
  undoLog?: UndoLog;
}

function defaultNewId(): ID {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class Engine {
  private _state: State = emptyState();
  private history: HistoryItem[] = [];
  private undoStack: UndoEntry[] = [];
  private listeners = new Set<() => void>();
  private readonly store: DataStore;
  private readonly newId: () => ID;
  private readonly now: () => Date;
  private readonly historyLimit: number;
  private readonly undoLog: UndoLog | null;
  private unsubscribeStore: (() => void) | null = null;
  actorId?: ID;
  ready = false;

  constructor(opts: EngineOptions) {
    this.store = opts.store;
    this.newId = opts.newId ?? defaultNewId;
    this.now = opts.now ?? (() => new Date());
    this.actorId = opts.actorId;
    this.historyLimit = opts.historyLimit ?? 10;
    this.undoLog = opts.undoLog ?? null;
  }

  get state(): State {
    return this._state;
  }

  /** 保存済みイベントを読み込み、以後の配信を受ける */
  async start(): Promise<void> {
    const events = await this.store.load();
    // 端末に残した「元に戻す」の一覧があれば、そのバッチの打ち消しに要る状態（各イベントの直前）をイベント列から作り直す
    const saved = this.undoLog?.load() ?? [];
    const present = new Set(events.map((e) => e.batchId));
    const wanted = new Set(saved.filter((u) => present.has(u.batchId)).map((u) => u.batchId));
    if (wanted.size > 0) {
      let s = emptyState();
      for (const ev of events) {
        if (wanted.has(ev.batchId)) this.history.push({ event: ev, before: s });
        s = applyEvents(s, [ev]);
      }
      this._state = s;
      this.undoStack = saved.filter((u) => wanted.has(u.batchId));
    } else {
      this._state = applyEvents(emptyState(), events);
    }
    this.unsubscribeStore = this.store.subscribe((incoming) => {
      this._state = applyEvents(this._state, incoming);
      this.emit();
    });
    this.ready = true;
    this.emit();
  }

  stop(): void {
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
    this.store.stop?.();
  }

  /** 保存層の種類と同期の状態（見出しの「同期中」「この端末の内容」に） */
  get storeKind(): DataStore["kind"] {
    return this.store.kind;
  }
  get syncStatus(): SyncStatus {
    return this.store.status ?? "local";
  }
  subscribeStatus(listener: () => void): () => void {
    return this.store.subscribeStatus?.(listener) ?? (() => {});
  }

  /** コマンドがイベントを作るための文脈。1回の操作＝1つの batchId */
  context(batchId: ID = this.newId()): EventContext {
    return { newId: this.newId, ts: this.now().toISOString(), batchId, actorId: this.actorId };
  }

  /** イベントを適用して保存する。label を渡すと元に戻せる操作として積む */
  async dispatch(events: Event[], label?: string): Promise<void> {
    if (events.length === 0) return;
    let s = this._state;
    const items: HistoryItem[] = [];
    for (const ev of events) {
      items.push({ event: ev, before: s });
      s = applyEvents(s, [ev]);
    }
    this._state = s;
    if (label) {
      this.history.push(...items);
      this.undoStack.push({ batchId: events[0].batchId, label, at: events[0].ts });
      this.trimHistory();
      this.undoLog?.save(this.undoStack);
    }
    this.emit();
    await this.store.append(events);
  }

  /** 直近の操作（または指定したバッチ）を元に戻す。戻した結果はこれ以上戻せない（やり直しは作らない） */
  async undo(batchId?: ID): Promise<UndoEntry | null> {
    const idx = batchId ? this.undoStack.findIndex((u) => u.batchId === batchId) : this.undoStack.length - 1;
    if (idx < 0) return null;
    const entry = this.undoStack[idx];
    const inverse = invertBatch(this.history, entry.batchId);
    if (inverse.length === 0) {
      this.undoStack.splice(idx, 1);
      return null;
    }
    const ctx = this.context();
    const events: Event[] = inverse.map((ev) => ({ ...ev, eventId: ctx.newId(), ts: ctx.ts, batchId: ctx.batchId, actorId: ctx.actorId }));
    this.undoStack.splice(idx, 1);
    this.history = this.history.filter((h) => h.event.batchId !== entry.batchId);
    this.undoLog?.save(this.undoStack);
    await this.dispatch(events);
    return entry;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get lastUndo(): UndoEntry | null {
    return this.undoStack[this.undoStack.length - 1] ?? null;
  }

  /** 「サンプルに戻す」: 保存を消して、渡されたイベントで作り直す */
  async reset(events: Event[]): Promise<void> {
    await this.store.clear();
    this.history = [];
    this.undoStack = [];
    this.undoLog?.save([]);
    this._state = applyEvents(emptyState(), events);
    this.emit();
    await this.store.append(events);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  private trimHistory(): void {
    while (this.undoStack.length > this.historyLimit) {
      const dropped = this.undoStack.shift();
      if (dropped) this.history = this.history.filter((h) => h.event.batchId !== dropped.batchId);
    }
  }
}
