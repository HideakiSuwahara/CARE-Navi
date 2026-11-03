/**
 * Supabase の events テーブルを SyncClient として使う（決定記録 0009、supabase/schema.sql）。
 * 鍵は環境変数（NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY）。コードや文書に書かない。
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Event } from "../domain/events.ts";
import type { SyncClient } from "./syncstore.ts";

interface Row {
  event_id: string;
  payload: Event;
}

/** 環境変数がそろっていれば設定を返す（未設定なら同期の項目を出さない） */
export function supabaseEnv(): { url: string; anonKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

let shared: SupabaseClient | null = null;

function clientOf(env: { url: string; anonKey: string }): SupabaseClient {
  if (!shared) shared = createClient(env.url, env.anonKey, { auth: { persistSession: false } });
  return shared;
}

const CHUNK = 200;

export function supabaseSyncClient(env: { url: string; anonKey: string }): SyncClient {
  const sb = clientOf(env);
  return {
    async fetchAll(code) {
      const out: Event[] = [];
      let from = 0;
      for (;;) {
        const { data, error } = await sb
          .from("events")
          .select("event_id,payload")
          .eq("facility_code", code)
          .order("id", { ascending: true })
          .range(from, from + 999);
        if (error) throw error;
        const rows = (data ?? []) as Row[];
        out.push(...rows.map((r) => r.payload));
        if (rows.length < 1000) break;
        from += 1000;
      }
      return out;
    },
    async insert(code, events) {
      for (let i = 0; i < events.length; i += CHUNK) {
        // event_id はテーブル全体で一意。サンプル施設のイベント ID は固定なので、施設コードを前に付けて施設ごとに分ける
        const rows = events.slice(i, i + CHUNK).map((e) => ({
          facility_code: code,
          event_id: `${code}:${e.eventId}`,
          batch_id: e.batchId,
          ts: e.ts,
          payload: e,
        }));
        // 同じ eventId は無視（別の端末から先に届いていても失敗にしない）
        const { error } = await sb.from("events").upsert(rows, { onConflict: "event_id", ignoreDuplicates: true });
        if (error) throw error;
      }
    },
    onInsert(code, cb, onStatus) {
      const channel = sb
        .channel(`events:${code}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "events", filter: `facility_code=eq.${code}` }, (msg) => {
          const row = msg.new as Row;
          if (row?.payload) cb([row.payload]);
        })
        .subscribe((status) => {
          // SUBSCRIBED → つながった。CHANNEL_ERROR / TIMED_OUT / CLOSED → 切れた
          onStatus?.(status === "SUBSCRIBED");
        });
      return () => {
        void sb.removeChannel(channel);
      };
    },
  };
}
