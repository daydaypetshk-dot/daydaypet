alter table public.pets
  add column if not exists timeline jsonb default '[]'::jsonb;
