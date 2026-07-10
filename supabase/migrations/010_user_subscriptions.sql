create table if not exists public.user_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  district text not null default '全港',
  endpoint text not null,
  subscription_json jsonb not null,
  created_at timestamptz not null default now()
);

create unique index if not exists user_subscriptions_endpoint_uidx on public.user_subscriptions (endpoint);
create index if not exists user_subscriptions_user_id_idx on public.user_subscriptions (user_id);
create index if not exists user_subscriptions_district_idx on public.user_subscriptions (district);

alter table public.user_subscriptions enable row level security;

create policy "user_subscriptions_select_self"
  on public.user_subscriptions
  for select
  to authenticated
  using (user_id = auth.uid());

create policy "user_subscriptions_insert_self"
  on public.user_subscriptions
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "user_subscriptions_update_self"
  on public.user_subscriptions
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "user_subscriptions_delete_self"
  on public.user_subscriptions
  for delete
  to authenticated
  using (user_id = auth.uid());

create policy "user_subscriptions_admin_all"
  on public.user_subscriptions
  for all
  to authenticated
  using (exists (select 1 from public.admin_users au where au.user_id = auth.uid()))
  with check (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));
