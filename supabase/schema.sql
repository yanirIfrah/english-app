-- לירד שעון נוכחות – database schema (Supabase / Postgres)

-- ---------- profiles ----------
create table if not exists public.profiles (
  id         uuid primary key references auth.users on delete cascade,
  username   text unique not null,
  name       text not null,
  emp_no     text not null default '',
  role       text not null default 'user' check (role in ('admin','manager','user')),
  perms      jsonb not null default '{}'::jsonb,   -- manager permissions: editHours, users, settings
  locked     boolean not null default false,
  created_at timestamptz not null default now(),
  last_seen  timestamptz
);
alter table public.profiles enable row level security;

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and not locked
$$;
create or replace function public.my_perm(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select case when role = 'admin' then true
                               when role = 'manager' then coalesce((perms->>p)::boolean, false)
                               else false end
                   from public.profiles where id = auth.uid() and not locked), false)
$$;

create policy "profiles read own or staff" on public.profiles
  for select using (id = auth.uid() or public.my_role() in ('admin','manager'));
create policy "profiles update own" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (last_seen) on public.profiles to authenticated;

-- ---------- settings ----------
create table if not exists public.app_config (
  id int primary key default 1 check (id = 1),
  data jsonb not null default '{"company":"לירד","stdHours":8.6,"overtime":true,"editMonths":2,"allowSignup":false}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.app_config (id) values (1) on conflict (id) do nothing;
alter table public.app_config enable row level security;
create policy "config readable" on public.app_config for select using (true);
create policy "config staff writes" on public.app_config for update using (public.my_perm('settings')) with check (public.my_perm('settings'));
revoke all on public.app_config from anon, authenticated;
grant select on public.app_config to anon, authenticated;
grant update (data, updated_at) on public.app_config to authenticated;

-- ---------- work entries (one row per employee per day) ----------
create table if not exists public.entries (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  day        date not null,
  kind       text not null default 'work' check (kind in ('work','vacation','sick')),
  start_time time,
  end_time   time,
  break_min  int not null default 0 check (break_min between 0 and 600),
  note       text not null default '' check (char_length(note) <= 300),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (user_id, day),
  check (kind <> 'work' or (start_time is not null and end_time is not null))
);
create index if not exists entries_day on public.entries (day);
alter table public.entries enable row level security;

-- the employee may change days from the 1st of the month N months back (N = editMonths, default 2)
-- up to the end of next month (to plan vacation days), Israel time
create or replace function public.can_edit_own_day(d date) returns boolean
language sql stable security definer set search_path = public as $$
  select d >= (date_trunc('month', (now() at time zone 'Asia/Jerusalem'))
               - make_interval(months => coalesce((select (data->>'editMonths')::int from public.app_config where id = 1), 2)))::date
     and d <  (date_trunc('month', (now() at time zone 'Asia/Jerusalem')) + interval '2 months')::date
$$;

create policy "entries read own or staff" on public.entries
  for select using (user_id = auth.uid() or public.my_role() in ('admin','manager'));
create policy "entries insert" on public.entries
  for insert with check ((user_id = auth.uid() and public.my_role() is not null and public.can_edit_own_day(day)) or public.my_perm('editHours'));
create policy "entries update" on public.entries
  for update using ((user_id = auth.uid() and public.my_role() is not null and public.can_edit_own_day(day)) or public.my_perm('editHours'))
  with check ((user_id = auth.uid() and public.my_role() is not null and public.can_edit_own_day(day)) or public.my_perm('editHours'));
create policy "entries delete" on public.entries
  for delete using ((user_id = auth.uid() and public.my_role() is not null and public.can_edit_own_day(day)) or public.my_perm('editHours'));
revoke all on public.entries from anon, authenticated;
grant select, insert, update, delete on public.entries to authenticated;

create or replace function public.entries_stamp() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now(); new.updated_by := auth.uid();
  if new.kind <> 'work' then new.start_time := null; new.end_time := null; new.break_min := 0; end if;
  return new;
end $$;
create trigger entries_stamp before insert or update on public.entries for each row execute function public.entries_stamp();

-- ---------- new auth user → profile (first user ever = admin) ----------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb); r text := 'user';
begin
  if not exists (select 1 from public.profiles where role = 'admin') then r := 'admin'; end if;
  insert into public.profiles (id, username, name, emp_no, role)
  values (new.id, lower(m->>'username'), coalesce(nullif(m->>'name',''), 'עובד'), coalesce(m->>'emp_no',''), r);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ---------- staff changes to a user ----------
create or replace function public.admin_update(target uuid, patch jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare me public.profiles; t public.profiles;
begin
  select * into me from public.profiles where id = auth.uid() and not locked;
  select * into t from public.profiles where id = target;
  if me.id is null or t.id is null then raise exception 'forbidden'; end if;
  if not (me.role = 'admin' or (me.role = 'manager' and coalesce((me.perms->>'users')::boolean,false) and t.role = 'user')) then raise exception 'forbidden'; end if;
  if patch ? 'name' and nullif(trim(patch->>'name'),'') is not null then update public.profiles set name = left(trim(patch->>'name'), 60) where id = target; end if;
  if patch ? 'emp_no' then update public.profiles set emp_no = left(coalesce(patch->>'emp_no',''), 30) where id = target; end if;
  if patch ? 'locked' and target <> me.id then update public.profiles set locked = (patch->>'locked')::boolean where id = target; end if;
  if patch ? 'role' and me.role = 'admin' and target <> me.id and patch->>'role' in ('manager','user') then
    update public.profiles set role = patch->>'role', perms = case when patch->>'role' = 'manager' then coalesce(patch->'perms', perms) else '{}'::jsonb end where id = target;
  elsif patch ? 'perms' and me.role = 'admin' and t.role = 'manager' then
    update public.profiles set perms = patch->'perms' where id = target;
  end if;
end $$;

alter publication supabase_realtime add table public.entries;
alter publication supabase_realtime add table public.profiles;

revoke execute on function public.admin_update(uuid, jsonb) from public, anon;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.admin_update(uuid, jsonb) to authenticated;
