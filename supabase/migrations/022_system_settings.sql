create table if not exists public.system_settings (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  value text not null,
  description text null
);

create index if not exists system_settings_key_idx
  on public.system_settings (key);

insert into public.system_settings (key, value, description)
values
  (
    'admin_whatsapp_number',
    '你的管理員預設電話',
    '接收新報料通知的管理員 WhatsApp 號碼'
  ),
  (
    'template_admin_notification',
    '【日日寵】有新報料喇！毛孩：${pet_name}，特徵：${description}。請即入後台審批：${admin_url}',
    '發送給管理員的審批提醒範本'
  ),
  (
    'template_citizen_approved',
    '【日日寵】好消息！您提交的報料（${pet_name}）已通過審核並正式上架！感謝您的熱心幫忙。查看連結：${pet_url}',
    '案件成功上架後發送給市民的通知範本'
  )
on conflict (key) do nothing;

alter table public.system_settings enable row level security;
