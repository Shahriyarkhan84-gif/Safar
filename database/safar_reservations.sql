-- Safar: reserved rides that are sent to drivers at pickup time, even when Safar Rides is closed.
-- Paste this whole file into Supabase > SQL Editor for the "safar" project and press Run.

create extension if not exists pg_cron;

create table if not exists public.reservations (
  id text primary key check (char_length(id) between 4 and 30),
  rider_account uuid not null references public.accounts(id) on delete cascade,
  pickup_at timestamptz not null,
  data jsonb not null,
  status text not null default 'scheduled' check (status in ('scheduled','sent','cancelled')),
  trip_id text,
  created_at timestamptz not null default now()
);
create index if not exists reservations_due_idx on public.reservations(status, pickup_at);
create index if not exists reservations_rider_idx on public.reservations(rider_account, pickup_at);
alter table public.reservations enable row level security;  -- no policies: only reachable through the functions below

create or replace function public.safar_reserve(p_token uuid, p_trip jsonb, p_pickup_at bigint)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare a public.accounts; rid text := p_trip->>'id'; at timestamptz;
begin
  a := public._safar_account(p_token, 'rides');
  if jsonb_typeof(p_trip) <> 'object' or char_length(p_trip::text) > 4000 or rid is null or char_length(rid) > 30 then raise exception 'That reservation is not valid.'; end if;
  at := to_timestamp(p_pickup_at / 1000.0);
  if at < now() + interval '2 minutes' then raise exception 'Choose a pickup time at least a few minutes from now.'; end if;
  if at > now() + interval '7 days' then raise exception 'You can reserve up to 7 days ahead.'; end if;
  if (select count(*) from public.reservations where rider_account = a.id and status = 'scheduled') >= 10 then
    raise exception 'You already have 10 reserved rides. Cancel one to add another.';
  end if;
  insert into public.reservations(id, rider_account, pickup_at, data)
    values (rid, a.id, at, (p_trip - 'id' - 'status' - 'requestAt'));
  return jsonb_build_object('id', rid);
end $$;

create or replace function public.safar_my_reservations(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare a public.accounts;
begin
  a := public._safar_account(p_token, 'rides');
  return coalesce((select jsonb_agg(r.data || jsonb_build_object('id', r.id, 'at', (extract(epoch from r.pickup_at) * 1000)::bigint) order by r.pickup_at)
    from public.reservations r where r.rider_account = a.id and r.status = 'scheduled'), '[]'::jsonb);
end $$;

create or replace function public.safar_cancel_reservation(p_token uuid, p_id text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare a public.accounts; n int;
begin
  a := public._safar_account(p_token, 'rides');
  update public.reservations set status = 'cancelled' where id = p_id and rider_account = a.id and status = 'scheduled';
  get diagnostics n = row_count;
  if n = 0 then raise exception 'That reservation has already been sent to drivers or cancelled.'; end if;
  return jsonb_build_object('id', p_id);
end $$;

-- Runs every minute: turns due reservations into live ride requests that Safar X drivers can accept.
create or replace function public.safar_dispatch_reservations()
returns int language plpgsql security definer set search_path = public, extensions as $$
declare r public.reservations; n int := 0; tid text;
begin
  for r in select * from public.reservations where status = 'scheduled' and pickup_at <= now() order by pickup_at limit 100 for update skip locked loop
    if exists (select 1 from public.trips where rider_account = r.rider_account and status in ('searching','accepted','ontrip')) then
      continue;  -- rider is already on a ride; try again next minute
    end if;
    tid := r.id || 'T';
    insert into public.trips(id, rider_account, status, data)
      values (tid, r.rider_account, 'searching', r.data || jsonb_build_object('status','searching','reserved', true,
        'requestAt', (extract(epoch from now()) * 1000)::bigint,
        'riderName', (select split_part(name, ' ', 1) from public.accounts where id = r.rider_account)))
      on conflict (id) do nothing;
    update public.reservations set status = 'sent', trip_id = tid where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.safar_dispatch_reservations() from public, anon, authenticated;
revoke all on function public.safar_reserve(uuid, jsonb, bigint) from public;
revoke all on function public.safar_my_reservations(uuid) from public;
revoke all on function public.safar_cancel_reservation(uuid, text) from public;
grant execute on function public.safar_reserve(uuid, jsonb, bigint), public.safar_my_reservations(uuid), public.safar_cancel_reservation(uuid, text) to anon, authenticated;

select cron.unschedule('safar-dispatch-reservations') where exists (select 1 from cron.job where jobname = 'safar-dispatch-reservations');
select cron.schedule('safar-dispatch-reservations', '* * * * *', 'select public.safar_dispatch_reservations()');
