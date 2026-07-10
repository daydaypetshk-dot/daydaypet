do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'facilities'
  ) then
    alter table public.facilities
      add column if not exists plus_code text;
  end if;
end $$;

alter table public.guide_places
  add column if not exists plus_code text;

alter table public.staged_places
  add column if not exists plus_code text;

create index if not exists guide_places_plus_code_idx
  on public.guide_places (plus_code);

create index if not exists staged_places_plus_code_idx
  on public.staged_places (plus_code);
