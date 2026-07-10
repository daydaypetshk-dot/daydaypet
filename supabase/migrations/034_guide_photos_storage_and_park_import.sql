insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'guide-photos',
  'guide-photos',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "guide_photos_public_read" on storage.objects;
create policy "guide_photos_public_read"
  on storage.objects
  for select
  to public
  using (bucket_id = 'guide-photos');

drop policy if exists "guide_photos_admin_insert" on storage.objects;
create policy "guide_photos_admin_insert"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'guide-photos'
    and exists (
      select 1
      from public.admin_users au
      where au.user_id = auth.uid()
    )
  );

drop policy if exists "guide_photos_admin_update" on storage.objects;
create policy "guide_photos_admin_update"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'guide-photos'
    and exists (
      select 1
      from public.admin_users au
      where au.user_id = auth.uid()
    )
  )
  with check (
    bucket_id = 'guide-photos'
    and exists (
      select 1
      from public.admin_users au
      where au.user_id = auth.uid()
    )
  );

drop policy if exists "guide_photos_admin_delete" on storage.objects;
create policy "guide_photos_admin_delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'guide-photos'
    and exists (
      select 1
      from public.admin_users au
      where au.user_id = auth.uid()
    )
  );

create unique index if not exists guide_places_name_address_uidx
  on public.guide_places (name, address);
