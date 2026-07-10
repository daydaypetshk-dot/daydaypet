alter table public.user_subscriptions
  alter column user_id drop not null;

drop policy if exists "user_subscriptions_insert_self" on public.user_subscriptions;
drop policy if exists "user_subscriptions_update_self" on public.user_subscriptions;

create policy "user_subscriptions_insert_public"
  on public.user_subscriptions
  for insert
  to anon, authenticated
  with check (
    user_id is null
    or user_id = auth.uid()
  );

create policy "user_subscriptions_update_public"
  on public.user_subscriptions
  for update
  to anon, authenticated
  using (
    user_id is null
    or user_id = auth.uid()
  )
  with check (
    user_id is null
    or user_id = auth.uid()
  );
