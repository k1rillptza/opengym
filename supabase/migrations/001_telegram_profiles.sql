create table if not exists public.gym_profiles (
  telegram_id text primary key,
  name text not null,
  username text,
  language_code text,
  state jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

comment on table public.gym_profiles is
  'Telegram Mini App profiles and synchronized openGym state.';

alter table public.gym_profiles enable row level security;

-- Intentionally no anon/authenticated policies. Only the Vercel function, using the
-- server-side service role key, can access this table. Telegram initData is verified there.
revoke all on table public.gym_profiles from anon, authenticated;
grant select, insert, update on table public.gym_profiles to service_role;
