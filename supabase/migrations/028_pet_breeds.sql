create table if not exists public.pet_breeds (
  id uuid primary key default gen_random_uuid(),
  pet_type text not null check (pet_type in ('cat', 'dog')),
  breed_name text not null,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  unique (pet_type, breed_name)
);

create index if not exists pet_breeds_pet_type_sort_idx
  on public.pet_breeds (pet_type, sort_order, breed_name);

alter table public.pet_breeds enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'pet_breeds'
      and policyname = 'pet_breeds_public_read'
  ) then
    create policy "pet_breeds_public_read"
      on public.pet_breeds
      for select
      to anon, authenticated
      using (true);
  end if;
end $$;

alter table public.pets
  add column if not exists breed text;

insert into public.pet_breeds (pet_type, breed_name, sort_order)
values
  ('dog', '唐狗', 1),
  ('dog', '柴犬', 2),
  ('dog', '哥基', 3),
  ('dog', '金毛尋回犬', 4),
  ('dog', '拉布拉多', 5),
  ('dog', '貴婦犬 / 貴賓犬', 6),
  ('dog', '博美', 7),
  ('dog', '松鼠狗', 8),
  ('dog', '法國鬥牛犬', 9),
  ('dog', '八哥', 10),
  ('dog', '比熊犬', 11),
  ('dog', '邊境牧羊犬', 12),
  ('dog', '西施犬', 13),
  ('dog', '迷你臘腸犬', 14),
  ('dog', '秋田犬', 15),
  ('dog', '雪納瑞', 16),
  ('dog', '其他 / 不確定品種', 999),
  ('cat', '唐貓', 1),
  ('cat', '英國短毛貓', 2),
  ('cat', '美國短毛貓', 3),
  ('cat', '布偶貓', 4),
  ('cat', '暹羅貓', 5),
  ('cat', '波斯貓', 6),
  ('cat', '緬因貓', 7),
  ('cat', '蘇格蘭摺耳貓', 8),
  ('cat', '孟加拉貓', 9),
  ('cat', '俄羅斯藍貓', 10),
  ('cat', '異國短毛貓', 11),
  ('cat', '英國長毛貓', 12),
  ('cat', '挪威森林貓', 13),
  ('cat', '斯芬克斯貓', 14),
  ('cat', '其他 / 不確定品種', 999)
on conflict (pet_type, breed_name) do update
set sort_order = excluded.sort_order;
