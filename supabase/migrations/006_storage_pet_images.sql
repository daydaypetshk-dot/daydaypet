insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'pet-images',
  'pet-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "pet_images_public_read" on storage.objects;
create policy "pet_images_public_read"
  on storage.objects
  for select
  to public
  using (bucket_id = 'pet-images');

drop policy if exists "pet_images_authenticated_upload" on storage.objects;
create policy "pet_images_authenticated_upload"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'pet-images');
