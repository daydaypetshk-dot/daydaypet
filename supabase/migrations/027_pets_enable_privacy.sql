alter table public.pets
add column if not exists enable_privacy boolean not null default true;

update public.pets
set enable_privacy = true
where enable_privacy is null;

