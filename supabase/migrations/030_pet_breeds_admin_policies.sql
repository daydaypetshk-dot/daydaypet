do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'pet_breeds'
      and policyname = 'pet_breeds_admin_insert'
  ) then
    create policy "pet_breeds_admin_insert"
      on public.pet_breeds
      for insert
      to authenticated
      with check (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'pet_breeds'
      and policyname = 'pet_breeds_admin_update'
  ) then
    create policy "pet_breeds_admin_update"
      on public.pet_breeds
      for update
      to authenticated
      using (exists (select 1 from public.admin_users au where au.user_id = auth.uid()))
      with check (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'pet_breeds'
      and policyname = 'pet_breeds_admin_delete'
  ) then
    create policy "pet_breeds_admin_delete"
      on public.pet_breeds
      for delete
      to authenticated
      using (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));
  end if;
end $$;
