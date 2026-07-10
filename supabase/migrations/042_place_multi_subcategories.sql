alter table public.guide_places
  add column if not exists subcategory_ids uuid[] not null default '{}'::uuid[];

alter table public.staged_places
  add column if not exists subcategory_ids uuid[] not null default '{}'::uuid[];

update public.guide_places
set subcategory_ids = array[subcategory_id]
where subcategory_id is not null
  and (subcategory_ids is null or cardinality(subcategory_ids) = 0);

update public.staged_places
set subcategory_ids = array[subcategory_id]
where subcategory_id is not null
  and (subcategory_ids is null or cardinality(subcategory_ids) = 0);

create index if not exists guide_places_subcategory_ids_gin_idx
  on public.guide_places using gin (subcategory_ids);

create index if not exists staged_places_subcategory_ids_gin_idx
  on public.staged_places using gin (subcategory_ids);
