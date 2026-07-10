create table if not exists public.user_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now()
);

alter table public.user_roles enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public' and tablename = 'user_roles' and policyname = 'user_can_read_own_role'
  ) then
    create policy user_can_read_own_role
      on public.user_roles
      for select
      to authenticated
      using (user_id = auth.uid());
  end if;
end $$;

insert into public.user_roles (user_id, role)
select user_id, 'admin'
from public.admin_users
on conflict (user_id) do update set role = excluded.role;

