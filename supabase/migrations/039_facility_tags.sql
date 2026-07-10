create table if not exists public.facility_tags (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  icon text not null default '',
  legacy_key text,
  match_keywords text[] not null default '{}'::text[],
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name)
);

create index if not exists facility_tags_sort_idx
  on public.facility_tags (sort_order, name);

create index if not exists facility_tags_active_idx
  on public.facility_tags (is_active);

create index if not exists facility_tags_keywords_gin_idx
  on public.facility_tags using gin (match_keywords);

create or replace function public.set_facility_tags_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_facility_tags_updated_at on public.facility_tags;
create trigger trg_facility_tags_updated_at
before update on public.facility_tags
for each row
execute function public.set_facility_tags_updated_at();

alter table public.facility_tags enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'facility_tags'
      and policyname = 'facility_tags_public_read'
  ) then
    create policy "facility_tags_public_read"
      on public.facility_tags
      for select
      to anon, authenticated
      using (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'facility_tags'
      and policyname = 'facility_tags_admin_insert'
  ) then
    create policy "facility_tags_admin_insert"
      on public.facility_tags
      for insert
      to authenticated
      with check (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'facility_tags'
      and policyname = 'facility_tags_admin_update'
  ) then
    create policy "facility_tags_admin_update"
      on public.facility_tags
      for update
      to authenticated
      using (exists (select 1 from public.admin_users au where au.user_id = auth.uid()))
      with check (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'facility_tags'
      and policyname = 'facility_tags_admin_delete'
  ) then
    create policy "facility_tags_admin_delete"
      on public.facility_tags
      for delete
      to authenticated
      using (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));
  end if;
end $$;

alter table public.guide_places
  add column if not exists facility_tag_ids uuid[] not null default '{}'::uuid[];

alter table public.staged_places
  add column if not exists facility_tag_ids uuid[] not null default '{}'::uuid[];

create index if not exists guide_places_facility_tag_ids_gin_idx
  on public.guide_places using gin (facility_tag_ids);

create index if not exists staged_places_facility_tag_ids_gin_idx
  on public.staged_places using gin (facility_tag_ids);

insert into public.facility_tags (name, icon, legacy_key, match_keywords, is_active, sort_order)
values
  ('有草地', '🌳', 'has_grass', array['草地','草坪','grass','turf']::text[], true, 10),
  ('設有清洗區', '🚿', 'has_wash_station', array['清洗','沖洗','洗手','狗廁所','飲水機','wash','shower','water fountain']::text[], true, 20),
  ('設有圍欄', '🧱', 'has_fencing', array['圍欄','圍封','fence','enclosed']::text[], true, 30),
  ('附近泊車', '🚗', 'has_parking', array['泊車','停車','車位','car park','parking']::text[], true, 40)
on conflict (name) do update
set icon = excluded.icon,
    legacy_key = excluded.legacy_key,
    match_keywords = excluded.match_keywords,
    is_active = excluded.is_active,
    sort_order = excluded.sort_order;

