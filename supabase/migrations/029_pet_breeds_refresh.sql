alter table public.pet_breeds
  drop constraint if exists pet_breeds_pet_type_check;

alter table public.pet_breeds
  add constraint pet_breeds_pet_type_check check (pet_type in ('cat', 'dog', 'bird'));

delete from public.pet_breeds
where pet_type in ('cat', 'dog', 'bird');

insert into public.pet_breeds (pet_type, breed_name, sort_order)
values
  ('dog', '唐狗', 1),
  ('dog', '貴婦狗 / Poodle', 2),
  ('dog', '柴犬', 3),
  ('dog', '哥基', 4),
  ('dog', '金毛尋回犬', 5),
  ('dog', '法國鬥牛犬', 6),
  ('dog', '松鼠狗 / Pomeranian', 7),
  ('dog', '史納莎', 8),
  ('dog', '芝娃娃', 9),
  ('dog', '拉布拉多', 10),
  ('dog', '其他 / 不確定品種', 999),
  ('cat', '唐貓 / 家貓 (短毛/長毛)', 1),
  ('cat', '英國短毛貓 (英短)', 2),
  ('cat', '美國短毛貓 (美短)', 3),
  ('cat', '布偶貓 (Ragdoll)', 4),
  ('cat', '摺耳貓', 5),
  ('cat', '波斯貓', 6),
  ('cat', '暹羅貓', 7),
  ('cat', '豹貓 (Bengal)', 8),
  ('cat', '其他 / 不確定品種', 999),
  ('bird', '雞尾鸚鵡 / 玄鳳 (Cockatiel)', 1),
  ('bird', '愛情鳥 / 情侶鸚鵡 (Lovebird)', 2),
  ('bird', '和尚鸚鵡 (Monk Parakeet)', 3),
  ('bird', '金太陽 / 錐尾鸚鵡 (Sun Conure)', 4),
  ('bird', '虎皮鸚鵡 / 阿蘇 (Budgie)', 5),
  ('bird', '非洲灰鸚鵡 (Grey Parrot)', 6),
  ('bird', '吸蜜鸚鵡 (Lorikeet)', 7),
  ('bird', '中大型鸚鵡 (如金剛/葵花/亞歷山大)', 8),
  ('bird', '相思鳥 / 綠繡眼', 9),
  ('bird', '文鳥 / 金絲雀 / 雀仔', 10),
  ('bird', '其他 / 不確定雀鳥品種', 999)
on conflict (pet_type, breed_name) do update
set sort_order = excluded.sort_order;
