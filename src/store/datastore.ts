/**
 * 保存層の境界。状態はイベント列から組み立てるので、保存層は「イベントを残す・配る」だけ。
 * - LocalStore: このブラウザに残す（サンプル施設・オフライン）。別タブへは BroadcastChannel で即時反映。
 * - SyncStore: 施設コードで同じ施設を見る端末同士に配る（Supabase の events テーブル）。打ち切り判断は決定記録0001。
 * どちらも同じ DataStore を満たすので、UI は差し替えに気づかない。
 */

import type { Event } from "../domain/events.ts";

/** 同期の状態。local は常に "local"。sync は接続前 connecting → 届けば online、届かなければ offline */
export type SyncStatus = "local" | "connecting" | "online" | "offline";

export interface DataStore {
  /** 保存済みのイベントを古い順に返す */
  load(): Promise<Event[]>;
  /** イベントを追記する（同じ eventId は無視してよい） */
  append(events: Event[]): Promise<void>;
  /** 他の端末・他のタブからのイベントを受け取る。戻り値は購読解除 */
  subscribe(listener: (events: Event[]) => void): () => void;
  /** すべて消す（「サンプルに戻す」） */
  clear(): Promise<void>;
  readonly kind: "memory" | "local" | "sync";
  /** 同期の状態（省略は "local"）と、その変化の購読 */
  readonly status?: SyncStatus;
  subscribeStatus?(listener: () => void): () => void;
  /** 購読をやめる（同期） */
  stop?(): void;
  /** 未送信の件数（同期） */
  readonly pendingCount?: number;
}

/** テストや SSR 用。何も残さない */
export class MemoryStore implements DataStore {
  readonly kind = "memory" as const;
  private events: Event[] = [];
  private listeners = new Set<(events: Event[]) => void>();

  constructor(initial: Event[] = []) {
    this.events = [...initial];
  }
  async load(): Promise<Event[]> {
    return [...this.events];
  }
  async append(events: Event[]): Promise<void> {
    const known = new Set(this.events.map((e) => e.eventId));
    const fresh = events.filter((e) => !known.has(e.eventId));
    this.events.push(...fresh);
  }
  subscribe(listener: (events: Event[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async clear(): Promise<void> {
    this.events = [];
  }
  /** テストから「他の端末」を装って流し込む */
  emit(events: Event[]): void {
    for (const l of this.listeners) l(events);
  }
}

/**
 * このブラウザに残す保存。
 * - localStorage にイベント列を JSON で持つ（サンプル施設の規模なら十分。大きくなれば IndexedDB へ）。
 * - BroadcastChannel で同一ブラウザの別タブへ配る（PC のボードと、横に置いたスマホ幅の窓）。
 * - 読み書きは try/catch で包む。プライベートモード等で使えないときはメモリだけで動く。
 */
export class LocalStore implements DataStore {
  readonly kind = "local" as const;
  private readonly key: string;
  private readonly channel: BroadcastChannel | null;
  private listeners = new Set<(events: Event[]) => void>();
  private memory: Event[] = [];

  constructor(facilityKey = "care-navi.events.v1") {
    this.key = facilityKey;
    let ch: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== "undefined") {
        ch = new BroadcastChannel(`${facilityKey}.bus`);
        // Node（テスト）では、開いたままだとプロセスが終わらない
        (ch as unknown as { unref?: () => void }).unref?.();
        ch.onmessage = (msg: MessageEvent<{ events?: Event[] }>) => {
          const evs = msg.data?.events;
          if (Array.isArray(evs) && evs.length > 0) {
            this.memory.push(...evs);
            for (const l of this.listeners) l(evs);
          }
        };
      }
    } catch {
      ch = null;
    }
    this.channel = ch;
  }

  private read(): Event[] {
    try {
      if (typeof localStorage === "undefined") return [...this.memory];
      const raw = localStorage.getItem(this.key);
      if (!raw) return [...this.memory];
      const parsed = JSON.parse(raw) as Event[];
      return Array.isArray(parsed) ? parsed : [...this.memory];
    } catch {
      return [...this.memory];
    }
  }

  private write(events: Event[]): void {
    this.memory = [...events];
    try {
      if (typeof localStorage !== "undefined") localStorage.setItem(this.key, JSON.stringify(events));
    } catch {
      // 容量超過や無効化。メモリにはあるので、この画面では動き続ける
    }
  }

  async load(): Promise<Event[]> {
    const evs = this.read();
    this.memory = [...evs];
    return evs;
  }

  async append(events: Event[]): Promise<void> {
    const current = this.read();
    const known = new Set(current.map((e) => e.eventId));
    const fresh = events.filter((e) => !known.has(e.eventId));
    if (fresh.length === 0) return;
    this.write([...current, ...fresh]);
    try {
      this.channel?.postMessage({ events: fresh });
    } catch {
      // 配れなくても保存はできている
    }
  }

  subscribe(listener: (events: Event[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async clear(): Promise<void> {
    this.memory = [];
    try {
      if (typeof localStorage !== "undefined") localStorage.removeItem(this.key);
    } catch {
      // 無視
    }
  }
}
