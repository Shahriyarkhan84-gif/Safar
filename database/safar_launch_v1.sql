-- Safar launch fixes v1: rider ratings, fees, delete account, share trip, live updates, error log.
-- Paste this whole file into Supabase > SQL Editor for the "safar" project and press Run.

-- ---------- tables ----------
alter table public.accounts alter column phone drop not null;
alter table public.accounts add column if not exists deleted_at timestamptz;
alter table public.trips add column if not exists share_token uuid;
create unique index if not exists trips_share_idx on public.trips(share_token) where share_token is not null;

create table if not exists public.client_errors (
  id bigserial primary key,
  app text not null,
  message text not null,
  detail text,
  url text,
  agent text,
  created_at timestamptz not null default now()
);
create index if not exists client_errors_time_idx on public.client_errors(created_at desc);
alter table public.client_errors enable row level security;  -- no policies: written only by safar_log_error

-- Deleted accounts can no longer be found by email or phone.
create or replace function public._safar_find(p_app text, p_ident text)
returns public.accounts language sql stable security definer set search_path = public as $$
  select * from public.accounts
   where app = p_app and deleted_at is null and (
     (position('@' in coalesce(p_ident,'')) > 0 and email = lower(trim(p_ident)))
     or (position('@' in coalesce(p_ident,'')) = 0 and phone = p_ident))
   order by created_at limit 1
$$;
revoke all on function public._safar_find(text, text) from public, anon, authenticated;

-- ---------- trip updates: fees worked out on the server, drivers rate riders ----------
create or replace function public.safar_update_trip(p_token uuid, p_app text, p_id text, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare a public.accounts; t public.trips; ns text; clean jsonb; fee numeric := 0; acc_ms bigint;
begin
  a := public._safar_account(p_token, p_app);
  if jsonb_typeof(p_patch) <> 'object' or char_length(p_patch::text) > 3000 then raise exception 'That change is not valid.'; end if;
  select * into t from public.trips where id = p_id for update;
  if t.id is null or (p_app = 'rides' and t.rider_account <> a.id) or (p_app = 'driver' and t.driver_account is distinct from a.id) then
    raise exception 'Trip not found.';
  end if;
  ns := coalesce(p_patch->>'status', t.status);
  if ns <> t.status then
    if p_app = 'rides' and not (
         (t.status = 'searching' and ns = 'accepted' and coalesce(p_patch->'driver'->>'sim','false') = 'true')
      or (t.status = 'searching' and ns = 'cancelled')
      or (t.status = 'accepted' and ns = 'cancelled')
      or (t.status = 'accepted' and ns = 'ontrip' and coalesce(t.data->'driver'->>'sim','false') = 'true')
      or (t.status = 'ontrip' and ns = 'completed')) then
      raise exception 'That ride has already moved on.';
    end if;
    if p_app = 'driver' and not (t.status = 'ontrip' and ns = 'completed') then
      raise exception 'That ride has already moved on.';
    end if;
  end if;
  -- fees and the rider's rating are never taken from the phone
  clean := p_patch - 'pin' - 'id' - 'status' - 'riderName' - 'cancelFee' - 'waitFee' - 'surge' - 'airportFee';
  if p_app = 'driver' then
    clean := clean - 'driver' - 'rating' - 'tip' - 'rated';
    if clean ? 'riderRating' and not (t.status = 'completed' or ns = 'completed') then clean := clean - 'riderRating'; end if;
    if jsonb_typeof(clean->'riderRating') = 'number' and (clean->>'riderRating')::numeric not between 1 and 5 then raise exception 'Ratings go from 1 to 5 stars.'; end if;
  else
    clean := clean - 'riderRating';
  end if;
  if p_app = 'rides' and t.status <> 'searching' then clean := clean - 'driver'; end if;
  if jsonb_typeof(clean->'rating') = 'number' and (clean->>'rating')::numeric not between 1 and 5 then raise exception 'Ratings go from 1 to 5 stars.'; end if;
  if jsonb_typeof(clean->'tip') = 'number' and ((clean->>'tip')::numeric < 0 or (clean->>'tip')::numeric > 50) then raise exception 'Tips can be up to £50.'; end if;
  -- cancellation fee: rider cancels more than 2 minutes after a real driver accepted
  if p_app = 'rides' and t.status = 'accepted' and ns = 'cancelled' and coalesce(t.data->'driver'->>'sim','false') <> 'true' then
    acc_ms := (t.data->>'acceptedAt')::bigint;
    if acc_ms is not null and extract(epoch from now()) * 1000 - acc_ms > 120000 then fee := 3.00; end if;
    clean := clean || jsonb_build_object('cancelFee', fee);
  end if;
  update public.trips set status = ns, updated_at = now(), data = data || clean || jsonb_build_object('status', ns) where id = p_id;
  return jsonb_build_object('id', p_id, 'status', ns, 'cancelFee', fee);
end $$;

-- waiting charge: 3 free minutes at pickup, then 25p a minute (up to £5)
create or replace function public.safar_start_trip(p_token uuid, p_id text, p_pin text, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare a public.accounts; t public.trips; arrived bigint; waited numeric; fee numeric := 0;
begin
  a := public._safar_account(p_token, 'driver');
  select * into t from public.trips where id = p_id for update;
  if t.id is null or t.driver_account is distinct from a.id or t.status <> 'accepted' then raise exception 'That trip is no longer waiting for you.'; end if;
  if coalesce(p_pin,'') <> t.data->>'pin' then raise exception 'That PIN does not match. Ask the rider to read it from Safar Rides again.'; end if;
  arrived := (t.data->>'acceptedAt')::bigint + coalesce((t.data->>'pickupDur')::bigint, 0);
  if arrived is not null then
    waited := (extract(epoch from now()) * 1000 - arrived) / 60000.0;
    if waited > 3 then fee := least(5.00, round(floor(waited - 3) * 0.25, 2)); end if;
  end if;
  update public.trips set status = 'ontrip', updated_at = now(),
    data = data || jsonb_build_object('status','ontrip','startedAt', p_patch->'startedAt', 'tripDur', p_patch->'tripDur', 'waitFee', fee)
  where id = p_id;
  return jsonb_build_object('id', p_id, 'waitFee', fee);
end $$;

-- drivers see the rider's average rating on new requests
create or replace function public.safar_driver_feed(p_token uuid, p_online boolean)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare a public.accounts; reqs jsonb := '[]'::jsonb; mine jsonb;
begin
  a := public._safar_account(p_token, 'driver');
  if p_online then
    reqs := coalesce((select jsonb_agg((t.data - 'pin') || jsonb_build_object('id', t.id, 'status', t.status,
        'riderStars', (select round(avg((r.data->>'riderRating')::numeric), 1) from public.trips r where r.rider_account = t.rider_account and jsonb_typeof(r.data->'riderRating') = 'number'))
        order by t.created_at)
      from public.trips t where t.status = 'searching' and t.created_at > now() - interval '30 seconds'), '[]'::jsonb);
  end if;
  mine := coalesce((select jsonb_agg((x.data - 'pin') || jsonb_build_object('id', x.id, 'status', x.status) order by x.created_at desc)
    from (select * from public.trips where driver_account = a.id order by created_at desc limit 40) x), '[]'::jsonb);
  return jsonb_build_object('requests', reqs, 'trips', mine);
end $$;

-- ---------- delete my account ----------
create or replace function public.safar_delete_account(p_token uuid, p_app text, p_password text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare a public.accounts;
begin
  a := public._safar_account(p_token, p_app);
  if a.password_hash <> crypt(coalesce(p_password,''), a.password_hash) then raise exception 'That password is not right.'; end if;
  if exists (select 1 from public.trips where (rider_account = a.id or driver_account = a.id) and status in ('searching','accepted','ontrip')) then
    raise exception 'Finish or cancel your current ride first.';
  end if;
  delete from public.reservations where rider_account = a.id and status = 'scheduled';
  delete from public.sessions where account_id = a.id;
  update public.trips set data = data || jsonb_build_object('riderName', 'Deleted user') where rider_account = a.id;
  update public.accounts set name = 'Deleted user', email = 'deleted-' || a.id || '@deleted.invalid', phone = null,
    password_hash = crypt(gen_random_uuid()::text, gen_salt('bf')), vehicle = null, deleted_at = now()
  where id = a.id;
  return jsonb_build_object('deleted', true);
end $$;

-- ---------- share my trip (a link family or friends can open without an account) ----------
create or replace function public.safar_share_trip(p_token uuid, p_id text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare a public.accounts; s uuid;
begin
  a := public._safar_account(p_token, 'rides');
  update public.trips set share_token = coalesce(share_token, gen_random_uuid()) where id = p_id and rider_account = a.id returning share_token into s;
  if s is null then raise exception 'Trip not found.'; end if;
  return jsonb_build_object('share', s);
end $$;

create or replace function public.safar_shared_trip(p_share uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare t public.trips;
begin
  select * into t from public.trips where share_token = p_share and created_at > now() - interval '12 hours';
  if t.id is null then raise exception 'This trip link has expired.'; end if;
  return jsonb_build_object('id', t.id, 'status', t.status, 'from', t.data->'from', 'to', t.data->'to', 'type', t.data->'type',
    'riderName', t.data->'riderName', 'mins', t.data->'mins', 'pickupMins', t.data->'pickupMins',
    'start', t.data->'start', 'acceptedAt', t.data->'acceptedAt', 'pickupDur', t.data->'pickupDur',
    'startedAt', t.data->'startedAt', 'tripDur', t.data->'tripDur', 'completedAt', t.data->'completedAt',
    'driver', case when t.data ? 'driver' then jsonb_build_object('name', split_part(t.data->'driver'->>'name', ' ', 1), 'car', t.data->'driver'->'car',
      'colour', t.data->'driver'->'colour', 'plate', t.data->'driver'->'plate') end);
end $$;

-- ---------- error log from the apps ----------
create or replace function public.safar_log_error(p_app text, p_message text, p_detail text, p_url text, p_agent text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_app not in ('rides','driver') then return; end if;
  if (select count(*) from public.client_errors where created_at > now() - interval '1 minute') > 120 then return; end if;
  insert into public.client_errors(app, message, detail, url, agent)
    values (p_app, left(coalesce(p_message,''), 500), left(p_detail, 2000), left(p_url, 300), left(p_agent, 300));
  delete from public.client_errors where created_at < now() - interval '30 days';
end $$;

-- ---------- live updates: tell the right phones when a trip changes ----------
create or replace function public._safar_trip_ping()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform realtime.send(jsonb_build_object('id', new.id, 'status', new.status), 'trip', 'safar-u-' || new.rider_account::text, false);
  if new.driver_account is not null then
    perform realtime.send(jsonb_build_object('id', new.id, 'status', new.status), 'trip', 'safar-u-' || new.driver_account::text, false);
  end if;
  if new.status = 'searching' or (tg_op = 'UPDATE' and old.status = 'searching') then
    perform realtime.send(jsonb_build_object('id', new.id, 'status', new.status), 'trip', 'safar-drivers', false);
  end if;
  return new;
exception when others then return new;  -- a failed ping must never block a trip
end $$;
drop trigger if exists safar_trip_ping on public.trips;
create trigger safar_trip_ping after insert or update on public.trips for each row execute function public._safar_trip_ping();

revoke all on function public._safar_trip_ping() from public, anon, authenticated;
revoke all on function public.safar_delete_account(uuid,text,text), public.safar_share_trip(uuid,text), public.safar_shared_trip(uuid), public.safar_log_error(text,text,text,text,text) from public;
grant execute on function public.safar_delete_account(uuid,text,text), public.safar_share_trip(uuid,text), public.safar_shared_trip(uuid), public.safar_log_error(text,text,text,text,text) to anon, authenticated;
