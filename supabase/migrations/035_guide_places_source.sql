alter table public.guide_places
  add column if not exists source text not null default 'manual';

update public.guide_places
set source = 'manual'
where source is null;

create index if not exists guide_places_source_idx
  on public.guide_places (source);
