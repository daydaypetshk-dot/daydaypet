alter table public.guide_places
  add column if not exists image_urls text[] not null default '{}'::text[];

alter table public.staged_places
  add column if not exists image_urls text[] not null default '{}'::text[];

update public.guide_places
set image_urls = array[image_url]
where coalesce(array_length(image_urls, 1), 0) = 0
  and image_url is not null
  and btrim(image_url) <> '';

update public.staged_places
set image_urls = array[image_url]
where coalesce(array_length(image_urls, 1), 0) = 0
  and image_url is not null
  and btrim(image_url) <> '';

create index if not exists guide_places_image_urls_gin_idx
  on public.guide_places using gin (image_urls);

create index if not exists staged_places_image_urls_gin_idx
  on public.staged_places using gin (image_urls);
