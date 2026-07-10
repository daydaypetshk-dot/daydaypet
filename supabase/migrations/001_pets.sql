create extension if not exists "pgcrypto";

create table if not exists public.pets (
  id uuid primary key default gen_random_uuid(),
  pet_name text not null,
  location text not null,
  lost_time text not null,
  features text not null,
  phone text not null,
  image_url text not null,
  source_url text not null,
  case_type text not null check (case_type in ('lost', 'spotted')),
  status text not null default 'pending' check (status in ('approved', 'pending')),
  latitude float8 not null,
  longitude float8 not null,
  created_at timestamptz not null default now()
);

create index if not exists pets_status_created_at_idx on public.pets (status, created_at desc);
create index if not exists pets_location_idx on public.pets (latitude, longitude);

alter table public.pets enable row level security;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

create policy "admin_users_select_self"
  on public.admin_users
  for select
  to authenticated
  using (user_id = auth.uid());

create policy "pets_public_read_approved"
  on public.pets
  for select
  to anon, authenticated
  using (status = 'approved');

create policy "pets_admin_all"
  on public.pets
  for all
  to authenticated
  using (exists (select 1 from public.admin_users au where au.user_id = auth.uid()))
  with check (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));

