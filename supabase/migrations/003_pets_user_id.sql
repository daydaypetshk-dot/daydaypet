alter table public.pets
add column if not exists user_id uuid references auth.users (id) on delete set null;

drop policy if exists "pets_public_read_approved" on public.pets;
create policy "pets_public_read_approved"
  on public.pets
  for select
  to anon, authenticated
  using (
    status = 'approved'
    or user_id = auth.uid()
    or exists (select 1 from public.admin_users au where au.user_id = auth.uid())
  );

drop policy if exists "pets_admin_all" on public.pets;
create policy "pets_admin_all"
  on public.pets
  for all
  to authenticated
  using (exists (select 1 from public.admin_users au where au.user_id = auth.uid()))
  with check (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));

create policy "pets_user_insert_pending"
  on public.pets
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and status = 'pending'
    and case_type in ('lost', 'spotted')
  );

