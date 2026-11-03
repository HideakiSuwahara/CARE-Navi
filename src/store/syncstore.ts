/**
 * 端末間の同期（決定記録 0009）。施設コードで同じ施設を見る端末同士に、イベントを配る。
 * - 遠くの保存は Supabase の events テーブル（1 施設コード = 1 列）。届いたイベントは Realtime で受ける。
 * - 近くの保存（このブラウザ）はキャッシュ。オフラインでも読める。送れなかったイベントは「未送信」として端末に残し、次に送れたときに送る。
 * - 画面は Engine の dispatch／undo だけを呼ぶので、LocalStore と差し替えても気づかない。
 * Supabase の呼び出しは SyncClient の後ろに隠す（単体テストは偽のクライアントで回す）。
 */

import type { Event } from "../domain/events.ts";
import { LocalStore, type DataStore, type SyncStatus } from "./datastore.ts";

export interface SyncClient {
  /** 施設コードのイベントを古い順に */
  fetchAll(code: string): Promise<Event[]>;
  /** 追記（同じ eventId は無視される） */
  insert(code: string, events: Event[]): Promise<void>;
  /** 届いたイベントを受ける。戻り値は購読解除 */
  onInsert(code: string, cb: (events: Event[]) => void): () => void;
}

const PENDING_PREFIX = "care-navi.pending.";

export class SyncStore implements DataStore {
  readonly kind = "sync" as const;
  private readonly cache: LocalStore;
  private readonly pendingKey: string;
  private listeners = new Set<(events: Event[]) => void>();
  private statusListeners = new Set<() => void>();
  private known = new Set<string>();
  private _status: SyncStatus = "connecting";
  private unsubscribeRemote: (() => void) | null = null;

  readonly code: string;
  private readonly client: SyncClient;

  constructor(code: string, client: SyncClient) {
    this.code = code;
    this.client = client;
    this.cache = new LocalStore(`care-navi.sync.${code}.v1`);
    this.pendingKey = `${PENDING_PREFIX}${code}`;
    // 同じブラウザの別タブから来た分も、ほかの端末と同じように配る
    this.cache.subscribe((evs) => this.receive(evs));
  }

  get status(): SyncStatus {
    return this._status;
  }

  subscribeStatus(listener: () => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private setStatus(s: SyncStatus): void {
    if (this._status === s) return;
    this._status = s;
    for (const l of this.statusListeners) l();
  }

  private receive(incoming: Event[]): void {
    const fresh = incoming.filter((e) => !this.known.has(e.eventId));
    if (fresh.length === 0) return;
    for (const e of fresh) this.known.add(e.eventId);
    for (const l of this.listeners) l(fresh);
  }

  /** 未送信（メモリ。localStorage があればそこにも残す） */
  private pending: Event[] = [];

  private readPending(): Event[] {
    try {
      const raw = typeof localStorage !== "undefined" ? localStorage.getItem(this.pendingKey) : null;
      if (raw) {
        const parsed = JSON.parse(raw) as Event[];
        if (Array.isArray(parsed)) this.pending = parsed;
      }
    } catch {
      // 読めなければメモリの分
    }
    return [...this.pending];
  }

  private writePending(events: Event[]): void {
    this.pending = [...events];
    try {
      if (typeof localStorage === "undefined") return;
      if (events.length === 0) localStorage.removeItem(this.pendingKey);
      else localStorage.setItem(this.pendingKey, JSON.stringify(events));
    } catch {
      // 残せなくても、このタブのメモリにはある
    }
  }

  /** 未送信のぶんを送る。送れたら空にする */
  private async flushPending(): Promise<void> {
    const pending = this.readPending();
    if (pending.length === 0) return;
    await this.client.insert(this.code, pending);
    this.writePending([]);
  }

  async load(): Promise<Event[]> {
    const cached = await this.cache.load();
    let events = cached;
    try {
      await this.flushPending();
      const remote = await this.client.fetchAll(this.code);
      // 遠くの保存が正。キャッシュにしかない分（未送信で残ったもの）は後ろに足す
      const ids = new Set(remote.map((e) => e.eventId));
      const onlyHere = cached.filter((e) => !ids.has(e.eventId));
      events = [...remote, ...onlyHere];
      await this.cache.clear();
      await this.cache.append(events);
      this.setStatus("online");
    } catch {
      this.setStatus("offline");
    }
    for (const e of events) this.known.add(e.eventId);
    this.unsubscribeRemote?.();
    this.unsubscribeRemote = this.client.onInsert(this.code, (evs) => {
      const fresh = evs.filter((e) => !this.known.has(e.eventId));
      if (fresh.length === 0) return;
      void this.cache.append(fresh);
      this.receive(fresh);
      this.setStatus("online");
    });
    return events;
  }

  async append(events: Event[]): Promise<void> {
    const fresh = events.filter((e) => !this.known.has(e.eventId));
    if (fresh.length === 0) return;
    for (const e of fresh) this.known.add(e.eventId);
    await this.cache.append(fresh);
    try {
      await this.flushPending();
      await this.client.insert(this.code, fresh);
      this.setStatus("online");
    } catch {
      this.writePending([...this.readPending(), ...fresh]);
      this.setStatus("offline");
    }
  }

  subscribe(listener: (events: Event[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** この端末のキャッシュだけを消す（遠くの保存は消さない。「サンプルに戻す」は同期では出さない） */
  async clear(): Promise<void> {
    this.known.clear();
    this.writePending([]);
    await this.cache.clear();
  }

  stop(): void {
    this.unsubscribeRemote?.();
    this.unsubscribeRemote = null;
  }

  /** 未送信の件数（画面の「この端末の内容」の補足に） */
  get pendingCount(): number {
    return this.readPending().length;
  }
}
