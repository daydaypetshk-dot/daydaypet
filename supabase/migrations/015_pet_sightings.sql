create table if not exists public.pet_sightings (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  sighting_time text not null,
  content text not null,
  created_at timestamptz not null default now()
);

alter table public.pet_sightings enable row level security;

