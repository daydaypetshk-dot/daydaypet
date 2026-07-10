alter table public.pet_sightings
  add column if not exists image_url text;
