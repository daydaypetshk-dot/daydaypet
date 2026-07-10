alter table public.notification_dispatch_logs
  drop constraint if exists notification_dispatch_logs_channel_check;

alter table public.notification_dispatch_logs
  add constraint notification_dispatch_logs_channel_check
  check (
    channel in (
      'whatsapp_owner_sighting',
      'in_app_owner_sighting',
      'whatsapp_admin_pending_report',
      'whatsapp_reporter_approved'
    )
  );
