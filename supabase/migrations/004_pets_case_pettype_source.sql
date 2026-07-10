alter table public.pets
add column if not exists pet_type text not null default 'other',
add column if not exists source_type text not null default 'self',
add column if not exists source_link text;

alter table public.pets drop constraint if exists pets_case_type_check;

update public.pets
set case_type = 'spotted_unrescued'
where case_type = 'spotted';

alter table public.pets
add constraint pets_case_type_check
check (case_type in ('lost', 'spotted_unrescued', 'found_rescued'));

alter table public.pets drop constraint if exists pets_pet_type_check;
alter table public.pets
add constraint pets_pet_type_check
check (pet_type in ('cat', 'dog', 'bird', 'other'));

alter table public.pets drop constraint if exists pets_source_type_check;
alter table public.pets
add constraint pets_source_type_check
check (source_type in ('self', 'social'));

update public.pets
set source_type = 'self'
where source_url like 'daydaypet://%';

update public.pets
set source_type = 'social'
where source_url not like 'daydaypet://%';

update public.pets
set source_link = source_url
where source_type = 'social'
  and (source_link is null or source_link = '');

drop policy if exists "pets_user_insert_pending" on public.pets;
create policy "pets_user_insert_pending"
  on public.pets
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and status = 'pending'
    and case_type in ('lost', 'spotted_unrescued', 'found_rescued')
  );

