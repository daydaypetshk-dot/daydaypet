create table if not exists public.guide_places (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.guide_categories(id) on delete cascade,
  subcategory_id uuid not null references public.guide_subcategories(id) on delete cascade,
  name text not null,
  district text not null,
  address text not null,
  opening_hours text,
  latitude numeric,
  longitude numeric,
  image_url text,
  has_grass boolean not null default false,
  has_wash_station boolean not null default false,
  has_fencing boolean not null default false,
  has_parking boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists guide_places_category_idx
  on public.guide_places (category_id);

create index if not exists guide_places_subcategory_idx
  on public.guide_places (subcategory_id);

create index if not exists guide_places_district_idx
  on public.guide_places (district);

create index if not exists guide_places_category_subcategory_district_idx
  on public.guide_places (category_id, subcategory_id, district);

create or replace function public.set_guide_places_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_guide_places_updated_at on public.guide_places;
create trigger trg_guide_places_updated_at
before update on public.guide_places
for each row
execute function public.set_guide_places_updated_at();

alter table public.guide_places enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'guide_places'
      and policyname = 'guide_places_public_read'
  ) then
    create policy "guide_places_public_read"
      on public.guide_places
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
      and tablename = 'guide_places'
      and policyname = 'guide_places_admin_insert'
  ) then
    create policy "guide_places_admin_insert"
      on public.guide_places
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
      and tablename = 'guide_places'
      and policyname = 'guide_places_admin_update'
  ) then
    create policy "guide_places_admin_update"
      on public.guide_places
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
      and tablename = 'guide_places'
      and policyname = 'guide_places_admin_delete'
  ) then
    create policy "guide_places_admin_delete"
      on public.guide_places
      for delete
      to authenticated
      using (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));
  end if;
end $$;
