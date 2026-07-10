alter table public.guide_places
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.staged_places
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists guide_places_metadata_gin_idx
  on public.guide_places using gin (metadata);

create index if not exists staged_places_metadata_gin_idx
  on public.staged_places using gin (metadata);

