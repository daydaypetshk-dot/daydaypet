create table if not exists public.guide_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  icon text not null,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  unique (name)
);

create table if not exists public.guide_subcategories (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.guide_categories(id) on delete cascade,
  name text not null,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  unique (category_id, name)
);

create index if not exists guide_categories_sort_idx
  on public.guide_categories (sort_order, name);

create index if not exists guide_subcategories_category_sort_idx
  on public.guide_subcategories (category_id, sort_order, name);

alter table public.guide_categories enable row level security;
alter table public.guide_subcategories enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'guide_categories'
      and policyname = 'guide_categories_public_read'
  ) then
    create policy "guide_categories_public_read"
      on public.guide_categories
      for select
      to anon, authenticated
      using (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'guide_subcategories'
      and policyname = 'guide_subcategories_public_read'
  ) then
    create policy "guide_subcategories_public_read"
      on public.guide_subcategories
      for select
      to anon, authenticated
      using (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'guide_categories'
      and policyname = 'guide_categories_admin_insert'
  ) then
    create policy "guide_categories_admin_insert"
      on public.guide_categories
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
      and tablename = 'guide_categories'
      and policyname = 'guide_categories_admin_update'
  ) then
    create policy "guide_categories_admin_update"
      on public.guide_categories
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
      and tablename = 'guide_categories'
      and policyname = 'guide_categories_admin_delete'
  ) then
    create policy "guide_categories_admin_delete"
      on public.guide_categories
      for delete
      to authenticated
      using (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'guide_subcategories'
      and policyname = 'guide_subcategories_admin_insert'
  ) then
    create policy "guide_subcategories_admin_insert"
      on public.guide_subcategories
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
      and tablename = 'guide_subcategories'
      and policyname = 'guide_subcategories_admin_update'
  ) then
    create policy "guide_subcategories_admin_update"
      on public.guide_subcategories
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
      and tablename = 'guide_subcategories'
      and policyname = 'guide_subcategories_admin_delete'
  ) then
    create policy "guide_subcategories_admin_delete"
      on public.guide_subcategories
      for delete
      to authenticated
      using (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));
  end if;
end $$;

insert into public.guide_categories (name, icon, sort_order)
values
  ('獸醫', '🩺', 1),
  ('寵物公園', '🌳', 2),
  ('寵物店', '🛒', 3),
  ('寵物美容', '✂️', 4),
  ('寵物善終', '🌈', 5),
  ('寵物訓練', '🎓', 6),
  ('寵物餐廳', '🍴', 7)
on conflict (name) do update
set icon = excluded.icon,
    sort_order = excluded.sort_order;

with seeded_subcategories as (
  select '獸醫'::text as category_name, '24小時急症'::text as name, 1 as sort_order
  union all select '獸醫', '珍禽異獸', 2
  union all select '獸醫', '貓專科醫院', 3
  union all select '獸醫', '中醫/針灸', 4
  union all select '獸醫', '普通門診', 5
  union all select '寵物公園', '寵物共享公園', 1
  union all select '寵物公園', '專用狗公園', 2
  union all select '寵物公園', '設有清洗區', 3
  union all select '寵物公園', '室內寵物公園', 4
  union all select '寵物店', '貓狗糧/用品', 1
  union all select '寵物店', '凍乾/生肉專門店', 2
  union all select '寵物店', '水族爬蟲', 3
  union all select '寵物店', '24H自助用品店', 4
  union all select '寵物美容', '貓隻免麻醉美容', 1
  union all select '寵物美容', '上門美容', 2
  union all select '寵物美容', '微氣泡SPA', 3
  union all select '寵物美容', '自助洗狗機', 4
  union all select '寵物善終', '24小時接送', 1
  union all select '寵物善終', '獨立火化', 2
  union all select '寵物善終', '集體火化', 3
  union all select '寵物善終', '紀念品處理', 4
  union all select '寵物訓練', '幼犬社交', 1
  union all select '寵物訓練', '行為糾正', 2
  union all select '寵物訓練', '唐狗善意訓練', 3
  union all select '寵物訓練', '上門一對一', 4
  union all select '寵物餐廳', '室內可入座', 1
  union all select '寵物餐廳', '只限戶外露天', 2
  union all select '寵物餐廳', '設有毛孩餐單', 3
  union all select '寵物餐廳', '貓狗Cafe', 4
)
insert into public.guide_subcategories (category_id, name, sort_order)
select c.id, s.name, s.sort_order
from seeded_subcategories s
join public.guide_categories c
  on c.name = s.category_name
on conflict (category_id, name) do update
set sort_order = excluded.sort_order;
