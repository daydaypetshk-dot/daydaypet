create table if not exists public.user_statuses (
  user_id uuid primary key references auth.users (id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'banned')),
  created_at timestamptz not null default now()
);

alter table public.user_statuses enable row level security;

