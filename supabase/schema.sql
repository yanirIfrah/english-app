-- לומדים אנגלית – Supabase schema
-- Users are created only through /api/admin (service role), so e-mail confirmation can stay on.

create table if not exists public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  username    text unique not null,
  name        text not null,
  age         int,
  gender      text not null default 'f',
  level       int  not null default 1,
  grade       int,
  bagrut      int,
  avatar      text not null default 'a1',
  stars       int  not null default 0,
  role        text not null default 'user' check (role in ('admin','manager','user')),
  mgr_perms   jsonb not null default '{}'::jsonb,
  ctrl        jsonb not null default '{}'::jsonb,
  locked      boolean not null default false,
  lock_msg    text not null default '',
  notice      text,
  data        jsonb not null default '{}'::jsonb,
  admin_at    timestamptz,
  created_at  timestamptz not null default now(),
  last_seen   timestamptz
);

alter table public.profiles enable row level security;

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

drop policy if exists "profiles read own or staff" on public.profiles;
create policy "profiles read own or staff" on public.profiles
  for select using (id = auth.uid() or public.my_role() in ('admin','manager'));

drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- users may change only their own learning data and display fields
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (name, age, gender, level, grade, bagrut, avatar, stars, data, last_seen) on public.profiles to authenticated;

-- profile row for every new auth user; the very first user becomes admin
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb); r text := 'user';
begin
  if not exists (select 1 from public.profiles where role = 'admin') then r := 'admin'; end if;
  insert into public.profiles (id, username, name, age, gender, level, grade, bagrut, avatar, role, ctrl)
  values (new.id, lower(m->>'username'), coalesce(nullif(m->>'name',''), 'משתמש'),
          nullif(m->>'age','')::int, coalesce(nullif(m->>'gender',''), 'f'),
          coalesce(nullif(m->>'level','')::int, 1), nullif(m->>'grade','')::int, nullif(m->>'bagrut','')::int,
          coalesce(nullif(m->>'avatar',''), 'a1'), r, coalesce(m->'ctrl', '{}'::jsonb));
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- staff changes to another user's settings
create or replace function public.admin_update(target uuid, patch jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare me public.profiles; perms jsonb;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null or me.role not in ('admin','manager') then raise exception 'forbidden'; end if;
  if me.role = 'manager' and exists (select 1 from public.profiles where id = target and role = 'admin') then raise exception 'forbidden'; end if;
  perms := case when me.role = 'admin'
                then '{"editProfile":true,"editPerms":true,"lock":true,"notice":true}'::jsonb
                else me.mgr_perms end;
  if patch ? 'profile' and coalesce((perms->>'editProfile')::boolean, false) then
    update public.profiles set
      name   = coalesce(nullif(patch->'profile'->>'name',''), name),
      age    = coalesce(nullif(patch->'profile'->>'age','')::int, age),
      level  = coalesce(nullif(patch->'profile'->>'level','')::int, level),
      gender = coalesce(nullif(patch->'profile'->>'gender',''), gender),
      grade  = case when patch->'profile' ? 'grade'  then nullif(patch->'profile'->>'grade','')::int  else grade end,
      bagrut = case when patch->'profile' ? 'bagrut' then nullif(patch->'profile'->>'bagrut','')::int else bagrut end,
      admin_at = now()
    where id = target;
  end if;
  if patch ? 'ctrl' and coalesce((perms->>'editPerms')::boolean, false) then
    update public.profiles set ctrl = patch->'ctrl', admin_at = now() where id = target;
  end if;
  if patch ? 'locked' and coalesce((perms->>'lock')::boolean, false) then
    update public.profiles set locked = (patch->>'locked')::boolean, lock_msg = coalesce(patch->>'lockMsg',''), admin_at = now() where id = target;
  end if;
  if patch ? 'notice' and coalesce((perms->>'notice')::boolean, false) then
    update public.profiles set notice = nullif(patch->>'notice',''), admin_at = now() where id = target;
  end if;
  if patch ? 'role' and me.role = 'admin' and target <> me.id and patch->>'role' in ('manager','user') then
    update public.profiles set role = patch->>'role', mgr_perms = coalesce(patch->'mgr_perms', '{}'::jsonb), admin_at = now() where id = target;
  end if;
end $$;
grant execute on function public.admin_update(uuid, jsonb) to authenticated;

create or replace function public.clear_my_notice() returns void
language sql security definer set search_path = public as $$
  update public.profiles set notice = null where id = auth.uid()
$$;
grant execute on function public.clear_my_notice() to authenticated;

-- app-wide settings (one row)
create table if not exists public.app_config (
  id int primary key default 1 check (id = 1),
  data jsonb not null default '{"allowSignup":true}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.app_config (id) values (1) on conflict (id) do nothing;
alter table public.app_config enable row level security;
drop policy if exists "config readable" on public.app_config;
create policy "config readable" on public.app_config for select using (true);
drop policy if exists "config admin writes" on public.app_config;
create policy "config admin writes" on public.app_config for update using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
revoke all on public.app_config from anon, authenticated;
grant select on public.app_config to anon, authenticated;
grant update (data, updated_at) on public.app_config to authenticated;

-- live updates for admin console and for users receiving admin changes
do $$ begin
  alter publication supabase_realtime add table public.profiles;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.app_config;
exception when duplicate_object then null; end $$;
revoke execute on function public.admin_update(uuid, jsonb) from public, anon;
revoke execute on function public.clear_my_notice() from public, anon;
