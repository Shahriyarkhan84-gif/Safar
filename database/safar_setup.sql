-- Safar: tables and secure functions for Safar Rides and Safar X.
-- Paste this whole file into Supabase > SQL Editor for the "safar" project and press Run.

create extension if not exists pgcrypto with schema extensions;

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  app text not null check (app in ('rides','driver')),
  name text not null check (char_length(name) between 2 and 80),
  email text not null check (char_length(email) between 5 and 160),
  phone text not null check (phone ~ '^7[0-9]{9}$'),
  password_hash text not null,
  vehicle jsonb,
  created_at timestamptz not null default now(),
  unique (app, phone)
);
create table public.sessions (
  token uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days'
);
create index sessions_account_idx on public.sessions(account_id);
create table public.trips (
  id text primary key check (char_length(id) between 4 and 40),
  rider_account uuid not null references public.accounts(id) on delete cascade,
  driver_account uuid references public.accounts(id) on delete set null,
  status text not null default 'searching' check (status in ('searching','accepted','ontrip','completed','cancelled')),
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index trips_status_idx on public.trips(status, created_at desc);
create index trips_rider_idx on public.trips(rider_account, created_at desc);
create index trips_driver_idx on public.trips(driver_account, created_at desc);

-- Row level security on, no policies: the tables are only reachable through the functions below.
alter table public.accounts enable row level security;
alter table public.sessions enable row level security;
alter table public.trips enable row level security;

create or replace function public._safar_account(p_token uuid, p_app text)
returns public.accounts language plpgsql security definer set search_path = public, extensions stable as $$
declare a public.accounts;
begin
  select acc.* into a from public.sessions s join public.accounts acc on acc.id = s.account_id
   where s.token = p_token and s.expires_at > now() and acc.app = p_app;
  if a.id is null then raise exception 'Your session has ended. Please log in again.' using errcode = 'P0001', hint = 'session'; end if;
  return a;
end $$;

create or replace function public._safar_public(a public.accounts)
returns jsonb language sql immutable set search_path = public as $$
  select jsonb_build_object('id', a.id, 'name', a.name, 'email', a.email, 'phone', a.phone, 'vehicle', a.vehicle)
$$;

create or replace function public.safar_signup(p_app text, p_name text, p_email text, p_phone text, p_password text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare a public.accounts; t uuid;
begin
  if p_app not in ('rides','driver') then raise exception 'Unknown app.'; end if;
  if char_length(trim(coalesce(p_name,''))) < 2 then raise exception 'Enter your full name.'; end if;
  if coalesce(p_email,'') !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$' then raise exception 'Enter a valid email address, for example you@example.com.'; end if;
  if coalesce(p_phone,'') !~ '^7[0-9]{9}$' then raise exception 'Enter a UK mobile number, for example 07700 900123.'; end if;
  if char_length(coalesce(p_password,'')) < 8 then raise exception 'Use a password of at least 8 characters.'; end if;
  if exists (select 1 from public.accounts where app = p_app and phone = p_phone) then raise exception 'That number already has an account. Log in instead.'; end if;
  insert into public.accounts(app, name, email, phone, password_hash)
    values (p_app, trim(p_name), lower(trim(p_email)), p_phone, crypt(p_password, gen_salt('bf')))
    returning * into a;
  insert into public.sessions(account_id) values (a.id) returning token into t;
  return jsonb_build_object('token', t, 'account', public._safar_public(a));
end $$;

create or replace function public.safar_login(p_app text, p_phone text, p_password text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare a public.accounts; t uuid;
begin
  select * into a from public.accounts where app = p_app and phone = p_phone;
  if a.id is null or a.password_hash <> crypt(coalesce(p_password,''), a.password_hash) then
    raise exception 'That mobile number and password do not match.';
  end if;
  delete from public.sessions where account_id = a.id and expires_at < now();
  insert into public.sessions(account_id) values (a.id) returning token into t;
  return jsonb_build_object('token', t, 'account', public._safar_public(a));
end $$;

create or replace function public.safar_me(p_token uuid, p_app text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin return public._safar_public(public._safar_account(p_token, p_app)); end $$;

create or replace function public.safar_logout(p_token uuid)
returns void language sql security definer set search_path = public as $$
  delete from public.sessions where token = p_token
$$;

create or replace function public.safar_set_vehicle(p_token uuid, p_vehicle jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare a public.accounts;
begin
  a := public._safar_account(p_token, 'driver');
  if jsonb_typeof(p_vehicle) <> 'object' or char_length(p_vehicle::text) > 2000 then raise exception 'Those car details could not be saved.'; end if;
  update public.accounts set vehicle = p_vehicle where id = a.id returning * into a;
  return public._safar_public(a);
end $$;

create or replace function public.safar_request_trip(p_token uuid, p_trip jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare a public.accounts; tid text := p_trip->>'id';
begin
  a := public._safar_account(p_token, 'rides');
  if jsonb_typeof(p_trip) <> 'object' or char_length(p_trip::text) > 4000 or tid is null then raise exception 'That ride request is not valid.'; end if;
  if exists (select 1 from public.trips where rider_account = a.id and status in ('searching','accepted','ontrip')) then
    raise exception 'You already have a ride in progress.';
  end if;
  insert into public.trips(id, rider_account, status, data)
    values (tid, a.id, 'searching', (p_trip - 'id' - 'status') || jsonb_build_object('status','searching','riderName', split_part(a.name,' ',1)));
  return jsonb_build_object('id', tid);
end $$;

create or replace function public.safar_my_trips(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare a public.accounts;
begin
  a := public._safar_account(p_token, 'rides');
  return coalesce((select jsonb_agg(x.data || jsonb_build_object('id', x.id, 'status', x.status) order by x.created_at desc)
    from (select * from public.trips where rider_account = a.id order by created_at desc limit 40) x), '[]'::jsonb);
end $$;

create or replace function public.safar_driver_feed(p_token uuid, p_online boolean)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare a public.accounts; reqs jsonb := '[]'::jsonb; mine jsonb;
begin
  a := public._safar_account(p_token, 'driver');
  if p_online then
    reqs := coalesce((select jsonb_agg((t.data - 'pin') || jsonb_build_object('id', t.id, 'status', t.status) order by t.created_at)
      from public.trips t where t.status = 'searching' and t.created_at > now() - interval '30 seconds'), '[]'::jsonb);
  end if;
  mine := coalesce((select jsonb_agg((x.data - 'pin') || jsonb_build_object('id', x.id, 'status', x.status) order by x.created_at desc)
    from (select * from public.trips where driver_account = a.id order by created_at desc limit 40) x), '[]'::jsonb);
  return jsonb_build_object('requests', reqs, 'trips', mine);
end $$;

create or replace function public.safar_accept_trip(p_token uuid, p_id text, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare a public.accounts; n int; r numeric;
begin
  a := public._safar_account(p_token, 'driver');
  if a.vehicle is null then raise exception 'Add your car before accepting rides.'; end if;
  if exists (select 1 from public.trips where driver_account = a.id and status in ('accepted','ontrip')) then raise exception 'Finish your current trip first.'; end if;
  select round(avg((t2.data->>'rating')::numeric), 2) into r from public.trips t2
    where t2.driver_account = a.id and jsonb_typeof(t2.data->'rating') = 'number';
  update public.trips set status = 'accepted', driver_account = a.id, updated_at = now(),
    data = data || (p_patch - 'pin' - 'status' - 'riderName' - 'driver') || jsonb_build_object('status','accepted',
      'driver', jsonb_build_object('name', a.name, 'car', a.vehicle->>'car', 'colour', a.vehicle->>'colour', 'plate', a.vehicle->>'plate', 'sim', false, 'rating', coalesce(r, 5.0)))
  where id = p_id and status = 'searching';
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Another driver took that ride.'; end if;
  return jsonb_build_object('id', p_id);
end $$;

create or replace function public.safar_start_trip(p_token uuid, p_id text, p_pin text, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare a public.accounts; t public.trips;
begin
  a := public._safar_account(p_token, 'driver');
  select * into t from public.trips where id = p_id for update;
  if t.id is null or t.driver_account is distinct from a.id or t.status <> 'accepted' then raise exception 'That trip is no longer waiting for you.'; end if;
  if coalesce(p_pin,'') <> t.data->>'pin' then raise exception 'That PIN does not match. Ask the rider to read it from Safar Rides again.'; end if;
  update public.trips set status = 'ontrip', updated_at = now(),
    data = data || jsonb_build_object('status','ontrip','startedAt', p_patch->'startedAt', 'tripDur', p_patch->'tripDur')
  where id = p_id;
  return jsonb_build_object('id', p_id);
end $$;

create or replace function public.safar_update_trip(p_token uuid, p_app text, p_id text, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare a public.accounts; t public.trips; ns text; clean jsonb;
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
  clean := p_patch - 'pin' - 'id' - 'status' - 'riderName';
  if p_app = 'driver' then clean := clean - 'driver' - 'rating' - 'tip' - 'rated'; end if;
  if p_app = 'rides' and t.status <> 'searching' then clean := clean - 'driver'; end if;
  if jsonb_typeof(clean->'rating') = 'number' and (clean->>'rating')::numeric not between 1 and 5 then raise exception 'Ratings go from 1 to 5 stars.'; end if;
  if jsonb_typeof(clean->'tip') = 'number' and ((clean->>'tip')::numeric < 0 or (clean->>'tip')::numeric > 50) then raise exception 'Tips can be up to £50.'; end if;
  update public.trips set status = ns, updated_at = now(), data = data || clean || jsonb_build_object('status', ns) where id = p_id;
  return jsonb_build_object('id', p_id, 'status', ns);
end $$;

revoke all on function public._safar_account(uuid, text) from public, anon, authenticated;
revoke all on function public._safar_public(public.accounts) from public, anon, authenticated;
revoke all on function public.safar_signup(text,text,text,text,text) from public;
revoke all on function public.safar_login(text,text,text) from public;
revoke all on function public.safar_me(uuid,text) from public;
revoke all on function public.safar_logout(uuid) from public;
revoke all on function public.safar_set_vehicle(uuid,jsonb) from public;
revoke all on function public.safar_request_trip(uuid,jsonb) from public;
revoke all on function public.safar_my_trips(uuid) from public;
revoke all on function public.safar_driver_feed(uuid,boolean) from public;
revoke all on function public.safar_accept_trip(uuid,text,jsonb) from public;
revoke all on function public.safar_start_trip(uuid,text,text,jsonb) from public;
revoke all on function public.safar_update_trip(uuid,text,text,jsonb) from public;
grant execute on function public.safar_signup(text,text,text,text,text), public.safar_login(text,text,text), public.safar_me(uuid,text),
  public.safar_logout(uuid), public.safar_set_vehicle(uuid,jsonb), public.safar_request_trip(uuid,jsonb), public.safar_my_trips(uuid),
  public.safar_driver_feed(uuid,boolean), public.safar_accept_trip(uuid,text,jsonb), public.safar_start_trip(uuid,text,text,jsonb),
  public.safar_update_trip(uuid,text,text,jsonb) to anon, authenticated;
