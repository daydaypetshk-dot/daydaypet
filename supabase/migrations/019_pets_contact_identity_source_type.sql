alter table public.pets
  drop constraint if exists pets_source_type_check;

alter table public.pets
  alter column source_type set default 'owner';

update public.pets
set source_type = case
  when source_type = 'self' and case_type = 'found_rescued' then 'rescued_finder'
  when source_type = 'self' and case_type = 'spotted_unrescued' then 'passerby'
  when source_type = 'self' then 'owner'
  when source_type = 'social' and case_type = 'found_rescued' then 'repost_rescued'
  when source_type = 'social' and case_type = 'spotted_unrescued' then 'repost_sighting'
  when source_type = 'social' then 'repost_owner'
  else source_type
end;

alter table public.pets
  add constraint pets_source_type_check
  check (
    source_type = any (
      array[
        'owner'::text,
        'repost_owner'::text,
        'passerby'::text,
        'repost_sighting'::text,
        'rescued_finder'::text,
        'repost_rescued'::text
      ]
    )
  );
