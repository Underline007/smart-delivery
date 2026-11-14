-- =====================================================================
-- Keep-alive
--
-- A free Supabase project is paused after 7 days without activity. A GitHub
-- Actions workflow calls public.keepalive() every few days (no sign-in needed).
-- It returns only the server time, so exposing it to `anon` leaks nothing.
--
-- _apply_grants() is replaced so that this one function stays callable by anon
-- when the grants are re-applied by later migrations.
-- =====================================================================

create or replace function public.keepalive()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select now()
$$;

create or replace function public._apply_grants()
returns void
language plpgsql
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure::text as sig, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
    if r.proname not like '\_%' and r.proname not like 'tg\_%' then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
    -- The only function the public (not signed in) may call.
    if r.proname = 'keepalive' then
      execute format('grant execute on function %s to anon', r.sig);
    end if;
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;

  revoke all on all tables in schema public from anon, authenticated;
  grant select on all tables in schema public to authenticated;
end
$$;

select public._apply_grants();
