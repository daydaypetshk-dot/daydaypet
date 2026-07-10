alter table public.pets
add column if not exists manual_address text;

alter table public.pets
alter column latitude drop not null,
alter column longitude drop not null;
