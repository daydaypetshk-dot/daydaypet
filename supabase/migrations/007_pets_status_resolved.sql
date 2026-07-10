alter table public.pets
  drop constraint if exists pets_status_check;

alter table public.pets
  add constraint pets_status_check
  check (status in ('approved', 'pending', 'resolved'));
