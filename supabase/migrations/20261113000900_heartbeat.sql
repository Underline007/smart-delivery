-- =====================================================================
-- Heartbeat
--
-- A free Supabase project is paused after about a week without activity.
-- Several independent pingers (GitHub Actions, an optional Cloudflare Worker)
-- call public.keepalive(). It now WRITES one row, so the database sees real
-- activity, and it tells the admin when the last ping happened.
--
-- Abuse bound: the row is written at most once per hour, however often
-- anyone calls the function.
-- =====================================================================

create table public.system_heartbeat (
  id smallint primary key default 1 check (id = 1),
  last_ping timestamptz not null default now(),
  pings bigint not null default 0
);

insert into public.system_heartbeat (id) values (1);

-- No policies: nobody reads or writes the table directly, only the functions below.
alter table public.system_heartbeat enable row level security;

drop function public.keepalive();

create function public.keepalive()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.system_heartbeat;
begin
  update public.system_heartbeat
  set last_ping = now(), pings = pings + 1
  where id = 1 and last_ping < now() - interval '1 hour'
  returning * into v;

  if not found then
    select * into v from public.system_heartbeat where id = 1;
  end if;
  return jsonb_build_object('last_ping', v.last_ping, 'pings', v.pings);
end
$$;

-- Admin: when was the project last pinged?
create function public.admin_heartbeat()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.system_heartbeat;
begin
  if not public.is_admin() then
    raise exception 'Chỉ admin được xem trạng thái giữ thức' using errcode = '42501';
  end if;
  select * into v from public.system_heartbeat where id = 1;
  return jsonb_build_object('last_ping', v.last_ping, 'pings', v.pings);
end
$$;

select public._apply_grants();
