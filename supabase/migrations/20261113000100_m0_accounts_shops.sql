-- =====================================================================
-- M0 · Accounts, shops, shop membership, system settings, audit log
--
-- Security model
--   * RLS is enabled on every table. Clients never write these tables
--     directly: every write goes through a SECURITY DEFINER function
--     below (or the admin-users Edge Function, which uses service_role).
--   * Account types: admin (whole system), owner, shipper.
--   * A shop has members (shop_members) with role owner or shipper.
--     Owners pick shippers from the shared pool; a shipper may belong
--     to several shops.
--   * Error messages are Vietnamese because the app shows them as-is.
-- =====================================================================

create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------
-- Text helpers
-- ---------------------------------------------------------------------

-- Search key for Vietnamese text: lower case, no diacritics, đ → d.
create or replace function public.vn_search_key(p text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select lower(extensions.unaccent(
    'extensions.unaccent'::regdictionary,
    translate(coalesce(p, ''), 'đĐ', 'dD')
  ))
$$;

-- Vietnamese mobile number → '0xxxxxxxxx', or null when invalid.
-- Accepts spaces, dots, dashes and the +84 / 84 prefix.
create or replace function public.normalize_vn_mobile(p text)
returns text
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
begin
  if d like '84%' and length(d) = 11 then
    d := '0' || substr(d, 3);
  end if;
  if d ~ '^0[35789][0-9]{8}$' then
    return d;
  end if;
  return null;
end
$$;

create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

-- ---------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------

create type public.account_type as enum ('admin', 'owner', 'shipper');
create type public.shop_role as enum ('owner', 'shipper');

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null check (length(btrim(full_name)) between 1 and 100),
  phone text not null unique check (phone ~ '^0[35789][0-9]{8}$'),
  account_type public.account_type not null,
  active boolean not null default true,
  must_change_password boolean not null default true,
  search_key text generated always as (public.vn_search_key(full_name) || ' ' || phone) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_type_idx on public.profiles (account_type) where active;
create index profiles_search_idx on public.profiles using gin (search_key extensions.gin_trgm_ops);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.tg_set_updated_at();

create table public.shops (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 100),
  phone text check (phone is null or phone ~ '^0[0-9]{9,10}$'),
  address text check (address is null or length(address) <= 300),
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  -- Prefix of order codes, e.g. 'AB' → AB261113-001. Unique so that codes
  -- stay unique across shops (useful when matching ViettelPost files).
  order_prefix text not null unique check (order_prefix ~ '^[A-Z0-9]{1,5}$'),
  active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger shops_updated_at before update on public.shops
  for each row execute function public.tg_set_updated_at();

create table public.shop_members (
  shop_id uuid not null references public.shops (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.shop_role not null,
  -- Removing a member only deactivates the row so history stays intact.
  active boolean not null default true,
  added_by uuid references public.profiles (id) on delete set null,
  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (shop_id, user_id)
);

create index shop_members_user_idx on public.shop_members (user_id, shop_id);

create trigger shop_members_updated_at before update on public.shop_members
  for each row execute function public.tg_set_updated_at();

-- A membership role must match the account type (owner ↔ owner, shipper ↔ shipper).
create or replace function public.tg_check_member_role()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_type public.account_type;
begin
  select account_type into v_type from public.profiles where id = new.user_id;
  if v_type is null or v_type::text <> new.role::text then
    raise exception 'Loại tài khoản không phù hợp với vai trò trong cửa hàng'
      using errcode = '22023';
  end if;
  return new;
end
$$;

create trigger shop_members_check_role before insert or update of role, user_id on public.shop_members
  for each row execute function public.tg_check_member_role();

create table public.system_settings (
  id smallint primary key default 1 check (id = 1),
  map_provider text not null default 'osm' check (map_provider in ('osm', 'google')),
  vtp_template_path text,
  vtp_template_version text,
  vtp_column_mapping jsonb,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.system_settings (id) values (1);

create trigger system_settings_updated_at before update on public.system_settings
  for each row execute function public.tg_set_updated_at();

create table public.audit_logs (
  id bigint generated always as identity primary key,
  shop_id uuid references public.shops (id) on delete set null,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_created_idx on public.audit_logs (created_at desc);
create index audit_logs_shop_idx on public.audit_logs (shop_id, created_at desc);

-- ---------------------------------------------------------------------
-- Permission helpers (used by RLS policies and RPCs)
-- ---------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and account_type = 'admin' and active
  )
$$;

-- Active owner of an active shop.
create or replace function public.is_shop_owner(p_shop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.shop_members m
    join public.shops s on s.id = m.shop_id
    join public.profiles p on p.id = m.user_id
    where m.shop_id = p_shop_id
      and m.user_id = (select auth.uid())
      and m.role = 'owner'
      and m.active and s.active and p.active
  )
$$;

-- Active member (any role) of an active shop.
create or replace function public.is_shop_member(p_shop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.shop_members m
    join public.shops s on s.id = m.shop_id
    join public.profiles p on p.id = m.user_id
    where m.shop_id = p_shop_id
      and m.user_id = (select auth.uid())
      and m.active and s.active and p.active
  )
$$;

create or replace function public.can_manage_shop(p_shop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() or public.is_shop_owner(p_shop_id)
$$;

-- True when the current user owns a shop that p_user_id belongs (or belonged) to.
create or replace function public.owns_shop_of(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.shop_members target
    where target.user_id = p_user_id
      and public.is_shop_owner(target.shop_id)
  )
$$;

create or replace function public._write_audit(
  p_shop_id uuid,
  p_action text,
  p_target_type text,
  p_target_id text,
  p_data jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_logs (shop_id, actor_id, action, target_type, target_id, data)
  values (p_shop_id, (select auth.uid()), p_action, p_target_type, p_target_id,
          coalesce(p_data, '{}'::jsonb))
$$;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.shops enable row level security;
alter table public.shop_members enable row level security;
alter table public.system_settings enable row level security;
alter table public.audit_logs enable row level security;

create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or public.is_admin()
    or public.owns_shop_of(id)
  );

create policy shops_select on public.shops
  for select to authenticated
  using (public.is_admin() or public.is_shop_member(id));

create policy shop_members_select on public.shop_members
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_admin()
    or public.is_shop_owner(shop_id)
  );

create policy system_settings_select on public.system_settings
  for select to authenticated
  using (true);

create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (
    public.is_admin()
    or (shop_id is not null and public.is_shop_owner(shop_id))
  );

-- ---------------------------------------------------------------------
-- RPC: current user
-- ---------------------------------------------------------------------

-- Profile of the signed-in user plus the active shops they belong to.
create or replace function public.my_context()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'profile', jsonb_build_object(
      'id', p.id,
      'full_name', p.full_name,
      'phone', p.phone,
      'account_type', p.account_type,
      'active', p.active,
      'must_change_password', p.must_change_password
    ),
    'shops', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', s.id, 'name', s.name, 'order_prefix', s.order_prefix, 'role', m.role)
        order by s.name
      )
      from public.shop_members m
      join public.shops s on s.id = m.shop_id
      where m.user_id = p.id and m.active and s.active
    ), '[]'::jsonb)
  )
  from public.profiles p
  where p.id = (select auth.uid()) and p.active
$$;

create or replace function public.mark_password_changed()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles
  set must_change_password = false
  where id = (select auth.uid())
$$;

-- ---------------------------------------------------------------------
-- RPC: admin · shops
-- ---------------------------------------------------------------------

create or replace function public.admin_list_shops()
returns table (
  id uuid,
  name text,
  phone text,
  address text,
  order_prefix text,
  active boolean,
  created_at timestamptz,
  owners jsonb,
  shipper_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Chỉ admin được xem danh sách cửa hàng' using errcode = '42501';
  end if;

  return query
  select
    s.id, s.name, s.phone, s.address, s.order_prefix, s.active, s.created_at,
    coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name, 'phone', p.phone)
                       order by p.full_name)
      from public.shop_members m
      join public.profiles p on p.id = m.user_id
      where m.shop_id = s.id and m.role = 'owner' and m.active
    ), '[]'::jsonb),
    (select count(*) from public.shop_members m
      where m.shop_id = s.id and m.role = 'shipper' and m.active)
  from public.shops s
  order by s.active desc, s.name;
end
$$;

create or replace function public.admin_create_shop(
  p_name text,
  p_order_prefix text,
  p_phone text default null,
  p_address text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Chỉ admin được tạo cửa hàng' using errcode = '42501';
  end if;

  begin
    insert into public.shops (name, order_prefix, phone, address, created_by)
    values (btrim(p_name), upper(btrim(p_order_prefix)), nullif(btrim(p_phone), ''),
            nullif(btrim(p_address), ''), (select auth.uid()))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Tiền tố mã đơn "%" đã được cửa hàng khác dùng', upper(btrim(p_order_prefix))
      using errcode = '23505';
  end;

  perform public._write_audit(v_id, 'shop.create', 'shop', v_id::text,
                             jsonb_build_object('name', p_name));
  return v_id;
end
$$;

create or replace function public.admin_update_shop(
  p_shop_id uuid,
  p_name text,
  p_order_prefix text,
  p_phone text,
  p_address text,
  p_active boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Chỉ admin được sửa cửa hàng' using errcode = '42501';
  end if;

  begin
    update public.shops
    set name = btrim(p_name),
        order_prefix = upper(btrim(p_order_prefix)),
        phone = nullif(btrim(p_phone), ''),
        address = nullif(btrim(p_address), ''),
        active = p_active
    where id = p_shop_id;
  exception when unique_violation then
    raise exception 'Tiền tố mã đơn "%" đã được cửa hàng khác dùng', upper(btrim(p_order_prefix))
      using errcode = '23505';
  end;

  if not found then
    raise exception 'Không tìm thấy cửa hàng' using errcode = 'P0002';
  end if;

  perform public._write_audit(p_shop_id, 'shop.update', 'shop', p_shop_id::text,
                             jsonb_build_object('name', p_name, 'active', p_active));
end
$$;

-- Add (p_active = true) or remove (false) an owner of a shop.
create or replace function public.admin_set_shop_owner(
  p_shop_id uuid,
  p_user_id uuid,
  p_active boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Chỉ admin được gán chủ cửa hàng' using errcode = '42501';
  end if;
  if not exists (select 1 from public.shops where id = p_shop_id) then
    raise exception 'Không tìm thấy cửa hàng' using errcode = 'P0002';
  end if;
  if p_active and not exists (
    select 1 from public.profiles
    where id = p_user_id and account_type = 'owner' and active
  ) then
    raise exception 'Tài khoản này không phải chủ cửa hàng đang hoạt động' using errcode = '22023';
  end if;

  insert into public.shop_members as m (shop_id, user_id, role, active, added_by)
  values (p_shop_id, p_user_id, 'owner', p_active, (select auth.uid()))
  on conflict (shop_id, user_id) do update
    set active = excluded.active, added_by = excluded.added_by;

  perform public._write_audit(p_shop_id,
                             case when p_active then 'shop.owner_add' else 'shop.owner_remove' end,
                             'profile', p_user_id::text);
end
$$;

-- Database size in bytes, to watch the 500 MB limit of the free plan.
create or replace function public.admin_db_usage()
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Chỉ admin được xem dung lượng' using errcode = '42501';
  end if;
  return pg_database_size(current_database());
end
$$;

-- ---------------------------------------------------------------------
-- RPC: admin · accounts (reads only; writes go through admin-users)
-- ---------------------------------------------------------------------

create or replace function public.admin_list_accounts(
  p_account_type public.account_type default null,
  p_query text default null
)
returns table (
  id uuid,
  full_name text,
  phone text,
  account_type public.account_type,
  active boolean,
  must_change_password boolean,
  created_at timestamptz,
  shops jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := nullif(public.vn_search_key(btrim(coalesce(p_query, ''))), '');
begin
  if not public.is_admin() then
    raise exception 'Chỉ admin được xem danh sách tài khoản' using errcode = '42501';
  end if;

  return query
  select
    p.id, p.full_name, p.phone, p.account_type, p.active, p.must_change_password, p.created_at,
    coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'role', m.role) order by s.name)
      from public.shop_members m
      join public.shops s on s.id = m.shop_id
      where m.user_id = p.id and m.active
    ), '[]'::jsonb)
  from public.profiles p
  where (p_account_type is null or p.account_type = p_account_type)
    and (v_q is null or p.search_key like '%' || v_q || '%')
  order by p.active desc, p.account_type, p.full_name;
end
$$;

-- ---------------------------------------------------------------------
-- RPC: shop owner · shippers of the shop
-- ---------------------------------------------------------------------

create or replace function public.list_shop_members(p_shop_id uuid)
returns table (
  user_id uuid,
  full_name text,
  phone text,
  role public.shop_role,
  active boolean,
  account_active boolean,
  added_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_shop(p_shop_id) then
    raise exception 'Bạn không có quyền quản lý cửa hàng này' using errcode = '42501';
  end if;

  return query
  select m.user_id, p.full_name, p.phone, m.role, m.active, p.active, m.added_at
  from public.shop_members m
  join public.profiles p on p.id = m.user_id
  where m.shop_id = p_shop_id
  order by m.active desc, m.role, p.full_name;
end
$$;

-- Search the shared shipper pool (active shipper accounts only).
create or replace function public.search_shippers(p_shop_id uuid, p_query text default null)
returns table (
  id uuid,
  full_name text,
  phone text,
  is_member boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := nullif(public.vn_search_key(btrim(coalesce(p_query, ''))), '');
begin
  if not public.can_manage_shop(p_shop_id) then
    raise exception 'Bạn không có quyền quản lý cửa hàng này' using errcode = '42501';
  end if;

  return query
  select p.id, p.full_name, p.phone,
         exists (select 1 from public.shop_members m
                 where m.shop_id = p_shop_id and m.user_id = p.id and m.active)
  from public.profiles p
  where p.account_type = 'shipper' and p.active
    and (v_q is null or p.search_key like '%' || v_q || '%')
  order by p.full_name
  limit 30;
end
$$;

create or replace function public.add_shop_shipper(p_shop_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_shop(p_shop_id) then
    raise exception 'Bạn không có quyền quản lý cửa hàng này' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = p_user_id and account_type = 'shipper' and active
  ) then
    raise exception 'Không tìm thấy shipper đang hoạt động' using errcode = 'P0002';
  end if;

  insert into public.shop_members (shop_id, user_id, role, active, added_by)
  values (p_shop_id, p_user_id, 'shipper', true, (select auth.uid()))
  on conflict (shop_id, user_id) do update
    set active = true, added_by = excluded.added_by;

  perform public._write_audit(p_shop_id, 'shop.shipper_add', 'profile', p_user_id::text);
end
$$;

create or replace function public.remove_shop_shipper(p_shop_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_shop(p_shop_id) then
    raise exception 'Bạn không có quyền quản lý cửa hàng này' using errcode = '42501';
  end if;

  -- M5 adds: refuse while the shipper has a trip in progress for this shop.
  update public.shop_members
  set active = false
  where shop_id = p_shop_id and user_id = p_user_id and role = 'shipper' and active;

  if not found then
    raise exception 'Shipper này không thuộc cửa hàng' using errcode = 'P0002';
  end if;

  perform public._write_audit(p_shop_id, 'shop.shipper_remove', 'profile', p_user_id::text);
end
$$;

-- Owner (or admin) edits the shop's contact info. Prefix and status stay admin-only.
create or replace function public.update_shop_info(
  p_shop_id uuid,
  p_name text,
  p_phone text,
  p_address text,
  p_lat double precision default null,
  p_lng double precision default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_shop(p_shop_id) then
    raise exception 'Bạn không có quyền quản lý cửa hàng này' using errcode = '42501';
  end if;
  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'Nhập tên cửa hàng' using errcode = '22023';
  end if;

  update public.shops
  set name = btrim(p_name),
      phone = nullif(btrim(p_phone), ''),
      address = nullif(btrim(p_address), ''),
      lat = p_lat,
      lng = p_lng
  where id = p_shop_id;

  perform public._write_audit(p_shop_id, 'shop.update_info', 'shop', p_shop_id::text,
                              jsonb_build_object('name', p_name));
end
$$;

-- ---------------------------------------------------------------------
-- Privileges
--   Supabase grants EXECUTE on new functions and ALL on new tables to anon /
--   authenticated by default. _apply_grants() resets that and is called at the
--   end of EVERY migration:
--     * functions: callable by `authenticated` unless the name starts with
--       "_" or "tg_" (internal helpers / triggers); never by `anon`
--     * tables: `authenticated` may only SELECT (RLS filters rows); every
--       write goes through a SECURITY DEFINER function
-- ---------------------------------------------------------------------

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
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;

  revoke all on all tables in schema public from anon, authenticated;
  grant select on all tables in schema public to authenticated;
end
$$;

select public._apply_grants();
