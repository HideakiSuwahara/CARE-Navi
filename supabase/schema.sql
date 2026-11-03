-- ケアナビ: 端末間の同期（決定記録 0009）
-- Supabase の SQL エディタにそのまま貼って実行する。events テーブル 1 つだけ。
-- 施設コード（facility_code）で絞る。施設コードは認証ではない（本番では認証・権限が要る。README）。

create table if not exists public.events (
  id bigint generated always as identity primary key,
  facility_code text not null,
  event_id text not null unique,
  batch_id text not null,
  ts timestamptz not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists events_facility_idx on public.events (facility_code, id);

-- テーブルの権限（新しいプロジェクトでは既定で付かないことがある。RLS のポリシーとは別に要る）
grant usage on schema public to anon, authenticated;
grant select, insert on public.events to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

alter table public.events enable row level security;

-- 試用の版: anon キーで読み書きできる（施設コードを知っている端末が同じ施設を見る）
drop policy if exists "anon can read events" on public.events;
create policy "anon can read events" on public.events for select to anon using (true);
drop policy if exists "anon can insert events" on public.events;
create policy "anon can insert events" on public.events for insert to anon with check (true);

-- Realtime（他の端末への即時配信）
alter publication supabase_realtime add table public.events;
