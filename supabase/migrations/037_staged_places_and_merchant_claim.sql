create table if not exists public.staged_places (
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
  status text not null default 'pending',
  source text not null default 'external',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'staged_places_status_check'
  ) then
    alter table public.staged_places
      add constraint staged_places_status_check
      check (status in ('pending', 'approved', 'rejected'));
  end if;
end $$;

create index if not exists staged_places_status_idx
  on public.staged_places (status);

create index if not exists staged_places_source_idx
  on public.staged_places (source);

create index if not exists staged_places_category_subcategory_district_idx
  on public.staged_places (category_id, subcategory_id, district);

create unique index if not exists staged_places_name_address_uidx
  on public.staged_places (name, address);

create or replace function public.set_staged_places_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_staged_places_updated_at on public.staged_places;
create trigger trg_staged_places_updated_at
before update on public.staged_places
for each row
execute function public.set_staged_places_updated_at();

alter table public.staged_places enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'staged_places'
      and policyname = 'staged_places_admin_read'
  ) then
    create policy "staged_places_admin_read"
      on public.staged_places
      for select
      to authenticated
      using (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'staged_places'
      and policyname = 'staged_places_admin_insert'
  ) then
    create policy "staged_places_admin_insert"
      on public.staged_places
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
      and tablename = 'staged_places'
      and policyname = 'staged_places_admin_update'
  ) then
    create policy "staged_places_admin_update"
      on public.staged_places
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
      and tablename = 'staged_places'
      and policyname = 'staged_places_admin_delete'
  ) then
    create policy "staged_places_admin_delete"
      on public.staged_places
      for delete
      to authenticated
      using (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));
  end if;
end $$;

alter table public.guide_places
  add column if not exists merchant_id uuid references auth.users(id) on delete set null;

alter table public.guide_places
  add column if not exists business_status text not null default 'unclaimed';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'guide_places_business_status_check'
  ) then
    alter table public.guide_places
      add constraint guide_places_business_status_check
      check (business_status in ('unclaimed', 'claimed'));
  end if;
end $$;

create index if not exists guide_places_business_status_idx
  on public.guide_places (business_status);

create index if not exists guide_places_merchant_id_idx
  on public.guide_places (merchant_id);

