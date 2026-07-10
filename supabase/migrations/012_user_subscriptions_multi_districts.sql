alter table public.user_subscriptions
  rename column district to districts;

alter table public.user_subscriptions
  alter column districts drop default;

alter table public.user_subscriptions
  alter column districts type jsonb
  using (
    case
      when districts is null or btrim(districts) = '' or districts = '全港' then '["all"]'::jsonb
      else jsonb_build_array(districts)
    end
  );

alter table public.user_subscriptions
  alter column districts set default '["all"]'::jsonb;

drop index if exists user_subscriptions_district_idx;
create index if not exists user_subscriptions_districts_gin_idx
  on public.user_subscriptions using gin (districts jsonb_path_ops);
