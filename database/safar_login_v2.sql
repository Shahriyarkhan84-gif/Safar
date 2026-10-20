-- Safar: sign in with email OR mobile number, account lookup for the "Continue" step,
-- and a lock after 5 wrong passwords (15 minutes).
-- Paste this whole file into Supabase > SQL Editor for the "safar" project and press Run.

create table if not exists public.login_attempts (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  fails int not null default 0,
  locked_until timestamptz
);
alter table public.login_attempts enable row level security;  -- no policies: functions only

create or replace function public._safar_find(p_app text, p_ident text)
returns public.accounts language sql stable security definer set search_path = public as $$
  select * from public.accounts
   where app = p_app and (
     (position('@' in coalesce(p_ident,'')) > 0 and email = lower(trim(p_ident)))
     or (position('@' in coalesce(p_ident,'')) = 0 and phone = p_ident))
   order by created_at limit 1
$$;
revoke all on function public._safar_find(text, text) from public, anon, authenticated;

create or replace function public.safar_lookup(p_app text, p_ident text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare a public.accounts;
begin
  if p_app not in ('rides','driver') or char_length(coalesce(p_ident,'')) > 160 then raise exception 'Enter a valid email or mobile number.'; end if;
  a := public._safar_find(p_app, p_ident);
  return jsonb_build_object('exists', a.id is not null);
end $$;

-- Login now accepts an email or a mobile number, and returns {error} instead of raising,
-- so failed attempts are counted (a raised error would undo the count).
create or replace function public.safar_login(p_app text, p_phone text, p_password text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare a public.accounts; t uuid; la public.login_attempts;
begin
  a := public._safar_find(p_app, p_phone);
  if a.id is null then return jsonb_build_object('error', 'That email or mobile number and password do not match.'); end if;
  select * into la from public.login_attempts where account_id = a.id;
  if la.locked_until is not null and la.locked_until > now() then
    return jsonb_build_object('error', 'Too many wrong passwords. Try again in ' || greatest(1, ceil(extract(epoch from (la.locked_until - now())) / 60))::int || ' min.');
  end if;
  if a.password_hash <> crypt(coalesce(p_password,''), a.password_hash) then
    insert into public.login_attempts(account_id, fails) values (a.id, 1)
      on conflict (account_id) do update set fails = public.login_attempts.fails + 1,
        locked_until = case when public.login_attempts.fails + 1 >= 5 then now() + interval '15 minutes' else null end;
    select * into la from public.login_attempts where account_id = a.id;
    if la.locked_until is not null then
      update public.login_attempts set fails = 0 where account_id = a.id;
      return jsonb_build_object('error', 'Too many wrong passwords. Your account is locked for 15 minutes.');
    end if;
    return jsonb_build_object('error', 'That email or mobile number and password do not match.');
  end if;
  delete from public.login_attempts where account_id = a.id;
  delete from public.sessions where account_id = a.id and expires_at < now();
  insert into public.sessions(account_id) values (a.id) returning token into t;
  return jsonb_build_object('token', t, 'account', public._safar_public(a));
end $$;

-- Sign-up also refuses an email that already has an account in the same app.
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
  if exists (select 1 from public.accounts where app = p_app and email = lower(trim(p_email))) then raise exception 'That email already has an account. Log in instead.'; end if;
  insert into public.accounts(app, name, email, phone, password_hash)
    values (p_app, trim(p_name), lower(trim(p_email)), p_phone, crypt(p_password, gen_salt('bf')))
    returning * into a;
  insert into public.sessions(account_id) values (a.id) returning token into t;
  return jsonb_build_object('token', t, 'account', public._safar_public(a));
end $$;

revoke all on function public.safar_lookup(text, text) from public;
grant execute on function public.safar_lookup(text, text) to anon, authenticated;
