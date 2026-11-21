-- Two (or more) ADMINs working side by side, live settings sync, optional correction reason.
create or replace function public.admin_update(target uuid, patch jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare t public.profiles; others int;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select * into t from public.profiles where id = target;
  if t.id is null then raise exception 'not_found'; end if;
  select count(*) into others from public.profiles where role = 'admin' and not locked and id <> target;
  if patch ? 'name' and nullif(trim(patch->>'name'),'') is not null then update public.profiles set name = left(trim(patch->>'name'), 60) where id = target; end if;
  if patch ? 'emp_no' then update public.profiles set emp_no = left(coalesce(patch->>'emp_no',''), 30) where id = target; end if;
  if patch ? 'branch' then update public.profiles set branch = left(coalesce(patch->>'branch',''), 40) where id = target; end if;
  if patch ? 'role' and patch->>'role' in ('admin','user') and patch->>'role' <> t.role then
    if target = auth.uid() then raise exception 'self_role'; end if;
    if t.role = 'admin' and others = 0 then raise exception 'last_admin'; end if;
    update public.profiles set role = patch->>'role', perms = '{}'::jsonb where id = target;
  end if;
  if patch ? 'locked' and target <> auth.uid() then
    if (patch->>'locked')::boolean and t.role = 'admin' and others = 0 then raise exception 'last_admin'; end if;
    update public.profiles set locked = (patch->>'locked')::boolean where id = target;
  end if;
end $$;
revoke execute on function public.admin_update(uuid, jsonb) from public, anon;
grant execute on function public.admin_update(uuid, jsonb) to authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='app_config') then
    alter publication supabase_realtime add table public.app_config;
  end if;
end $$;

update public.app_config set data = jsonb_set(data, '{requireReason}', 'false'::jsonb) where id = 1;
