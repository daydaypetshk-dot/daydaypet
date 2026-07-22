create table if not exists public.fb_scrape_jobs (
  id uuid primary key default gen_random_uuid(),
  requested_by_user_id uuid null,
  job_token text not null,
  status text not null default 'queued',
  mode text not null default 'live',
  max_groups integer not null default 0,
  max_posts_per_group integer not null default 12,
  total_groups integer not null default 0,
  next_group_index integer not null default 0,
  processed_groups integer not null default 0,
  candidates integer not null default 0,
  upserted integer not null default 0,
  group_errors jsonb not null default '[]'::jsonb,
  ai_status_counts jsonb null,
  current_group_id uuid null,
  current_group_name text null,
  last_message text null,
  last_error text null,
  requested_at timestamptz not null default timezone('utc', now()),
  started_at timestamptz null,
  finished_at timestamptz null,
  last_heartbeat_at timestamptz null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint fb_scrape_jobs_status_check check (status in ('queued', 'running', 'completed', 'failed')),
  constraint fb_scrape_jobs_mode_check check (mode in ('live', 'mock')),
  constraint fb_scrape_jobs_job_token_not_blank check (char_length(trim(job_token)) > 0)
);

create index if not exists fb_scrape_jobs_status_requested_idx
  on public.fb_scrape_jobs (status, requested_at desc);

create index if not exists fb_scrape_jobs_requested_at_idx
  on public.fb_scrape_jobs (requested_at desc);

alter table public.fb_scrape_jobs enable row level security;
