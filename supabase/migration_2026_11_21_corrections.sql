-- 21 Nov 2026: only ADMIN sees others; employees enter today directly; earlier days go through ADMIN approval.
update public.profiles set role = 'user', perms = '{}'::jsonb where role = 'manager';

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and not locked)
$$;
create or replace function public.il_today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Jerusalem')::date $$;
create or replace function public.corr_from() returns date
language sql stable as $$ select (date_trunc('month', (now() at time zone 'Asia/Jerusalem')) - interval '1 month')::date $$;

-- profiles: own row or admin
drop policy if exists "profiles read own or staff" on public.profiles;
create policy "profiles read own or admin" on public.profiles for select using (id = auth.uid() or public.is_admin());

-- settings: admin writes
drop policy if exists "config staff writes" on public.app_config;
create policy "config admin writes" on public.app_config for update using (public.is_admin()) with check (public.is_admin());

-- entries: read own or admin; an employee writes only today's row; admin writes anything
drop policy if exists "entries read own or staff" on public.entries;
drop policy if exists "entries insert" on public.entries;
drop policy if exists "entries update" on public.entries;
drop policy if exists "entries delete" on public.entries;
create policy "entries read own or admin" on public.entries for select using (user_id = auth.uid() or public.is_admin());
create policy "entries insert" on public.entries for insert with check ((user_id = auth.uid() and public.my_role() is not null and day = public.il_today()) or public.is_admin());
create policy "entries update" on public.entries for update
  using ((user_id = auth.uid() and public.my_role() is not null and day = public.il_today()) or public.is_admin())
  with check ((user_id = auth.uid() and public.my_role() is not null and day = public.il_today()) or public.is_admin());
create policy "entries delete" on public.entries for delete using ((user_id = auth.uid() and public.my_role() is not null and day = public.il_today()) or public.is_admin());

-- correction requests
create table if not exists public.corrections (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  day         date not null,
  action      text not null default 'upsert' check (action in ('upsert','delete')),
  kind        text not null default 'work' check (kind in ('work','vacation','sick')),
  start_time  time,
  end_time    time,
  break_min   int not null default 0 check (break_min between 0 and 600),
  note        text not null default '' check (char_length(note) <= 300),
  reason      text not null default '' check (char_length(reason) <= 300),
  status      text not null default 'pending' check (status in ('pending','approved','rejected')),
  admin_note  text not null default '' check (char_length(admin_note) <= 300),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  decided_by  uuid,
  check (action = 'delete' or kind <> 'work' or (start_time is not null and end_time is not null))
);
create unique index if not exists corrections_one_pending on public.corrections (user_id, day) where status = 'pending';
create index if not exists corrections_status on public.corrections (status, created_at);
alter table public.corrections enable row level security;
create policy "corrections read own or admin" on public.corrections for select using (user_id = auth.uid() or public.is_admin());
create policy "corrections request" on public.corrections for insert with check (
  user_id = auth.uid() and public.my_role() is not null and status = 'pending' and decided_at is null
  and day >= public.corr_from() and day < public.il_today());
create policy "corrections cancel own pending" on public.corrections for delete using (user_id = auth.uid() and status = 'pending');
revoke all on public.corrections from anon, authenticated;
grant select, delete on public.corrections to authenticated;
grant insert (user_id, day, action, kind, start_time, end_time, break_min, note, reason) on public.corrections to authenticated;

create or replace function public.decide_correction(cid bigint, approve boolean, note text default '') returns void
language plpgsql security definer set search_path = public as $$
declare c public.corrections;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select * into c from public.corrections where id = cid and status = 'pending' for update;
  if c.id is null then raise exception 'not_pending'; end if;
  if approve then
    if c.action = 'delete' then
      delete from public.entries where user_id = c.user_id and day = c.day;
    else
      insert into public.entries (user_id, day, kind, start_time, end_time, break_min, note)
      values (c.user_id, c.day, c.kind, c.start_time, c.end_time, c.break_min, c.note)
      on conflict (user_id, day) do update set kind = excluded.kind, start_time = excluded.start_time, end_time = excluded.end_time,
        break_min = excluded.break_min, note = excluded.note;
    end if;
  end if;
  update public.corrections set status = case when approve then 'approved' else 'rejected' end,
    admin_note = left(coalesce(note,''), 300), decided_at = now(), decided_by = auth.uid() where id = cid;
end $$;
revoke execute on function public.decide_correction(bigint, boolean, text) from public, anon;
grant execute on function public.decide_correction(bigint, boolean, text) to authenticated;

-- staff changes to a user: ADMIN only (name, employee number, block)
create or replace function public.admin_update(target uuid, patch jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.profiles where id = target) then raise exception 'not_found'; end if;
  if patch ? 'name' and nullif(trim(patch->>'name'),'') is not null then update public.profiles set name = left(trim(patch->>'name'), 60) where id = target; end if;
  if patch ? 'emp_no' then update public.profiles set emp_no = left(coalesce(patch->>'emp_no',''), 30) where id = target; end if;
  if patch ? 'locked' and target <> auth.uid() then update public.profiles set locked = (patch->>'locked')::boolean where id = target; end if;
end $$;
revoke execute on function public.admin_update(uuid, jsonb) from public, anon;
grant execute on function public.admin_update(uuid, jsonb) to authenticated;

alter publication supabase_realtime add table public.corrections;
