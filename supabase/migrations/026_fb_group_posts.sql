create table if not exists public.fb_group_posts (
  id uuid primary key default gen_random_uuid(),
  source_group_id uuid not null,
  fb_post_id text not null,
  post_url text not null,
  post_created_at timestamptz null,
  content_text text null,
  image_urls jsonb not null default '[]'::jsonb,
  raw_payload jsonb null,
  ai_status text not null default 'pending',
  ai_result jsonb null,
  ai_error text null,
  ai_processed_at timestamptz null,
  first_seen_at timestamptz not null default timezone('utc', now()),
  last_seen_at timestamptz not null default timezone('utc', now()),
  constraint fb_group_posts_source_group_id_not_blank check (source_group_id::text <> ''),
  constraint fb_group_posts_fb_post_id_not_blank check (char_length(trim(fb_post_id)) > 0),
  constraint fb_group_posts_post_url_not_blank check (char_length(trim(post_url)) > 0),
  constraint fb_group_posts_ai_status check (
    ai_status in ('pending', 'processing', 'done', 'failed', 'skipped')
  )
);

create unique index if not exists fb_group_posts_group_post_unique_idx
  on public.fb_group_posts (source_group_id, fb_post_id);

create unique index if not exists fb_group_posts_post_url_unique_idx
  on public.fb_group_posts (lower(post_url));

create index if not exists fb_group_posts_group_last_seen_idx
  on public.fb_group_posts (source_group_id, last_seen_at desc);

create index if not exists fb_group_posts_ai_status_last_seen_idx
  on public.fb_group_posts (ai_status, last_seen_at desc);

alter table public.fb_group_posts enable row level security;
