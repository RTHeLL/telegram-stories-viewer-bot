-- Таблицы для мониторинга и истории снимков (DATA_STORAGE=supabase).
-- Выполните в SQL Editor вашего проекта Supabase.

create table if not exists public.monitored_targets (
  id bigserial primary key,
  owner_chat_id text not null,
  target_link text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (owner_chat_id, target_link)
);

create table if not exists public.story_history (
  id bigserial primary key,
  owner_chat_id text not null,
  target_link text not null,
  monitored_target_id bigint references public.monitored_targets (id) on delete set null,
  source text not null check (source in ('manual', 'monitor')),
  fetched_at timestamptz not null default now(),
  payload_json text not null
);

create index if not exists idx_story_history_owner_target
  on public.story_history (owner_chat_id, target_link);
