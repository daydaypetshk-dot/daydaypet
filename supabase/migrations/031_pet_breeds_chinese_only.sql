delete from public.pet_breeds
where pet_type in ('dog', 'cat', 'bird')
  and (
    breed_name ~ '\('
    or breed_name ~ '\)'
    or breed_name ~ '/\s*[A-Za-z]'
    or lower(breed_name) like '%poodle%'
    or lower(breed_name) like '%pomeranian%'
    or lower(breed_name) like '%cockatiel%'
    or lower(breed_name) like '%lovebird%'
    or lower(breed_name) like '%budgie%'
    or lower(breed_name) like '%parakeet%'
    or lower(breed_name) like '%conure%'
    or lower(breed_name) like '%ragdoll%'
    or lower(breed_name) like '%bengal%'
    or lower(breed_name) like '%lorikeet%'
    or lower(breed_name) like '%grey%'
  );

insert into public.pet_breeds (pet_type, breed_name, sort_order)
values
  ('dog', '唐狗', 1),
  ('dog', '貴婦狗', 2),
  ('dog', '柴犬', 3),
  ('dog', '哥基', 4),
  ('dog', '金毛尋回犬', 5),
  ('dog', '法國鬥牛犬', 6),
  ('dog', '松鼠狗', 7),
  ('dog', '史納莎', 8),
  ('dog', '芝娃娃', 9),
  ('dog', '拉布拉多', 10),
  ('dog', '其他 / 不確定品種', 999),
  ('cat', '唐貓 / 家貓', 1),
  ('cat', '英國短毛貓', 2),
  ('cat', '美國短毛貓', 3),
  ('cat', '布偶貓', 4),
  ('cat', '摺耳貓', 5),
  ('cat', '波斯貓', 6),
  ('cat', '暹羅貓', 7),
  ('cat', '豹貓', 8),
  ('cat', '其他 / 不確定品種', 999),
  ('bird', '雞尾鸚鵡 / 玄鳳', 1),
  ('bird', '愛情鳥 / 情侶鸚鵡', 2),
  ('bird', '和尚鸚鵡', 3),
  ('bird', '金太陽 / 錐尾鸚鵡', 4),
  ('bird', '虎皮鸚鵡 / 阿蘇', 5),
  ('bird', '非洲灰鸚鵡', 6),
  ('bird', '吸蜜鸚鵡', 7),
  ('bird', '中大型鸚鵡', 8),
  ('bird', '相思鳥 / 綠繡眼', 9),
  ('bird', '文鳥 / 金絲雀 / 雀仔', 10),
  ('bird', '其他 / 不確定雀鳥品種', 999)
on conflict (pet_type, breed_name) do update
set sort_order = excluded.sort_order;
