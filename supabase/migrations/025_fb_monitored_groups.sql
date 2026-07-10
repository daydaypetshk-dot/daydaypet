create table if not exists public.fb_monitored_groups (
  id uuid primary key default gen_random_uuid(),
  group_name text not null,
  group_url text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  constraint fb_monitored_groups_group_name_not_blank check (char_length(trim(group_name)) > 0),
  constraint fb_monitored_groups_group_url_not_blank check (char_length(trim(group_url)) > 0),
  constraint fb_monitored_groups_group_url_format check (
    group_url ~* '^https?://(www\.)?(facebook\.com|fb\.com)/groups/[^/?#]+/?$'
  )
);

create unique index if not exists fb_monitored_groups_group_url_unique_idx
  on public.fb_monitored_groups (lower(group_url));

create index if not exists fb_monitored_groups_active_created_idx
  on public.fb_monitored_groups (is_active, created_at desc);

alter table public.fb_monitored_groups enable row level security;
