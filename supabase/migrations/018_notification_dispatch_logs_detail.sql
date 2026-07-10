alter table public.notification_dispatch_logs
  add column if not exists owner_user_id uuid references auth.users (id) on delete set null,
  add column if not exists status text not null default 'sent' check (status in ('sent', 'skipped_rate_limited'));

alter table public.notification_dispatch_logs
  drop constraint if exists notification_dispatch_logs_channel_check;

alter table public.notification_dispatch_logs
  add constraint notification_dispatch_logs_channel_check
  check (channel in ('whatsapp_owner_sighting', 'in_app_owner_sighting'));

update public.notification_dispatch_logs as logs
set owner_user_id = pets.user_id
from public.pets as pets
where logs.pet_id = pets.id
  and logs.owner_user_id is null;

create index if not exists notification_dispatch_logs_owner_created_idx
  on public.notification_dispatch_logs (owner_user_id, created_at desc);
