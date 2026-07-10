create table if not exists public.notification_dispatch_logs (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets (id) on delete cascade,
  channel text not null check (channel in ('whatsapp_owner_sighting')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists notification_dispatch_logs_pet_channel_created_idx
  on public.notification_dispatch_logs (pet_id, channel, created_at desc);

alter table public.notification_dispatch_logs enable row level security;
