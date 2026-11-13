-- =====================================================================
-- M5 · Delivery trips (own shippers)
--
--   * An owner groups confirmed "self delivery" orders into a trip, puts the
--     stops in route order and assigns a shipper of the shop.
--   * The shipper sees ONLY his own trips, through get_my_trips(): name,
--     phone, address, COD, notes — never costs, totals or other customers.
--   * Results (delivered / failed) go through complete_stop / fail_stop, which
--     also move the order and, the first time, save the GPS fix as the
--     customer's location.
--   * While an order sits in an unfinished trip its status cannot be changed
--     from the order screen, so the two never disagree.
-- =====================================================================

create table public.delivery_trips (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  code text not null,
  trip_date date not null default (now() at time zone 'Asia/Ho_Chi_Minh')::date,
  shipper_id uuid not null references public.profiles (id),
  start_lat double precision check (start_lat between -90 and 90),
  start_lng double precision check (start_lng between -180 and 180),
  end_mode text not null default 'return' check (end_mode in ('return', 'last')),
  status text not null default 'draft' check (status in ('draft', 'in_progress', 'done', 'cancelled')),
  optimizer text not null default 'manual' check (optimizer in ('local', 'ors', 'manual')),
  distance_m integer check (distance_m is null or distance_m >= 0),
  duration_s integer check (duration_s is null or duration_s >= 0),
  cod_expected bigint not null default 0,
  cod_collected bigint not null default 0,
  note text check (note is null or length(note) <= 500),
  started_at timestamptz,
  finished_at timestamptz,
  settled_at timestamptz,
  settled_by uuid references public.profiles (id) on delete set null,
  settled_amount bigint,
  settle_note text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, code),
  check ((start_lat is null) = (start_lng is null))
);

create index delivery_trips_shop_idx on public.delivery_trips (shop_id, trip_date desc);
create index delivery_trips_shipper_idx on public.delivery_trips (shipper_id, status);

create trigger delivery_trips_updated_at before update on public.delivery_trips
  for each row execute function public.tg_set_updated_at();

create table public.delivery_stops (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  trip_id uuid not null references public.delivery_trips (id) on delete cascade,
  order_id uuid not null references public.orders (id),
  seq integer not null check (seq > 0),
  status text not null default 'pending' check (status in ('pending', 'delivered', 'failed')),
  fail_reason text check (fail_reason is null or length(fail_reason) <= 200),
  cod_collected bigint check (cod_collected is null or cod_collected >= 0),
  proof_photo_path text,
  note text check (note is null or length(note) <= 500),
  done_at timestamptz,
  done_lat double precision check (done_lat between -90 and 90),
  done_lng double precision check (done_lng between -180 and 180),
  unique (trip_id, seq) deferrable initially deferred
);

create index delivery_stops_trip_idx on public.delivery_stops (trip_id, seq);
-- An order can wait in only one trip at a time.
create unique index delivery_stops_one_pending on public.delivery_stops (order_id) where status = 'pending';

alter table public.delivery_trips enable row level security;
alter table public.delivery_stops enable row level security;

create policy delivery_trips_select on public.delivery_trips
  for select to authenticated using (public.can_manage_shop(shop_id));
create policy delivery_stops_select on public.delivery_stops
  for select to authenticated using (public.can_manage_shop(shop_id));

-- ---------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------

-- The owner / admin of the shop, or the shipper the trip is assigned to.
create or replace function public._trip_actor_ok(p_shop_id uuid, p_shipper_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.can_manage_shop(p_shop_id)
      or (
        p_shipper_id = (select auth.uid())
        and exists (
          select 1
          from public.shop_members m
          join public.shops s on s.id = m.shop_id
          join public.profiles p on p.id = m.user_id
          where m.shop_id = p_shop_id and m.user_id = (select auth.uid())
            and m.role = 'shipper' and m.active and s.active and p.active
        )
      )
$$;

-- Marks the trip done once nothing is pending, and refreshes the collected COD.
create or replace function public._refresh_trip(p_trip_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.delivery_trips t
  set cod_collected = coalesce((
        select sum(s.cod_collected) from public.delivery_stops s
        where s.trip_id = t.id and s.status = 'delivered'
      ), 0),
      status = case
        when t.status = 'in_progress'
             and not exists (select 1 from public.delivery_stops s where s.trip_id = t.id and s.status = 'pending')
          then 'done' else t.status end,
      finished_at = case
        when t.status = 'in_progress'
             and not exists (select 1 from public.delivery_stops s where s.trip_id = t.id and s.status = 'pending')
          then now() else t.finished_at end
  where t.id = p_trip_id;
end
$$;

-- Orders in an unfinished trip are handled from the trip. (Replaces the M3 function.)
create or replace function public._apply_order_status(
  p_shop_id uuid,
  p_order_id uuid,
  p_to text,
  p_note text default null
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  o public.orders;
begin
  select * into o from public.orders where id = p_order_id and shop_id = p_shop_id for update;
  if not found then
    raise exception 'Không tìm thấy đơn hàng' using errcode = 'P0002';
  end if;
  if not public._order_transition_allowed(o.status, p_to) then
    raise exception 'Không thể chuyển đơn % từ "%" sang "%"', o.code, o.status, p_to using errcode = '55000';
  end if;
  if p_to in ('cancelled', 'new') and exists (
    select 1 from public.delivery_stops s where s.order_id = o.id and s.status = 'pending'
  ) then
    raise exception 'Đơn % đang nằm trong một chuyến giao chưa hoàn tất. Huỷ chuyến trước.', o.code
      using errcode = '55000';
  end if;

  if p_to = 'confirmed' and o.status = 'new' then
    perform public._deduct_order_stock(p_shop_id, o.id, o.code);
  elsif p_to = 'cancelled' and o.stock_deducted then
    perform public._restore_order_stock(p_shop_id, o.id, o.code, 'order_cancel', 'Huỷ đơn');
  elsif p_to = 'new' and o.stock_deducted then
    perform public._restore_order_stock(p_shop_id, o.id, o.code, 'order_cancel', 'Mở lại đơn');
  elsif p_to = 'returned' and o.stock_deducted then
    perform public._restore_order_stock(p_shop_id, o.id, o.code, 'return', 'Hàng hoàn về');
  end if;

  update public.orders
  set status = p_to,
      confirmed_at = case when p_to = 'confirmed' and o.status = 'new' then now()
                          when p_to = 'new' then null else confirmed_at end,
      shipped_at = case when p_to = 'shipping' and shipped_at is null then now() else shipped_at end,
      delivered_at = case when p_to = 'delivered' then now() else delivered_at end,
      cancelled_at = case when p_to = 'cancelled' then now() else cancelled_at end
  where id = o.id;

  insert into public.order_events (shop_id, order_id, from_status, to_status, note, actor_id)
  values (p_shop_id, o.id, o.status, p_to, nullif(btrim(p_note), ''), (select auth.uid()));

  if o.customer_id is not null then
    perform public._refresh_customer_stats(o.customer_id);
  end if;
end
$$;

-- Manual status changes are refused while the order is on a trip. (Replaces the M3 function.)
create or replace function public.set_order_status(
  p_shop_id uuid,
  p_order_id uuid,
  p_to text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from text;
begin
  if not public.can_manage_shop(p_shop_id) then
    raise exception 'Bạn không có quyền quản lý cửa hàng này' using errcode = '42501';
  end if;
  if p_to = 'vtp_exported' then
    raise exception 'Trạng thái này được đặt khi xuất file ViettelPost' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.delivery_stops s
    where s.order_id = p_order_id and s.shop_id = p_shop_id and s.status = 'pending'
  ) then
    raise exception 'Đơn đang nằm trong một chuyến giao. Hãy cập nhật kết quả giao ở chuyến.' using errcode = '55000';
  end if;

  select status into v_from from public.orders where id = p_order_id and shop_id = p_shop_id;
  perform public._apply_order_status(p_shop_id, p_order_id, p_to, p_note);

  if p_to = 'cancelled' then
    perform public._write_audit(p_shop_id, 'order.cancel', 'order', p_order_id::text,
                                jsonb_build_object('from', v_from, 'note', p_note));
  elsif p_to = 'new' then
    perform public._write_audit(p_shop_id, 'order.reopen', 'order', p_order_id::text);
  end if;
end
$$;

-- A shipper with an unfinished trip cannot be removed from the shop. (Replaces the M0 function.)
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
  if exists (
    select 1 from public.delivery_trips
    where shop_id = p_shop_id and shipper_id = p_user_id and status in ('draft', 'in_progress')
  ) then
    raise exception 'Shipper này còn chuyến giao chưa hoàn tất. Hãy huỷ hoặc kết thúc chuyến trước.' using errcode = '55000';
  end if;

  update public.shop_members
  set active = false
  where shop_id = p_shop_id and user_id = p_user_id and role = 'shipper' and active;

  if not found then
    raise exception 'Shipper này không thuộc cửa hàng' using errcode = 'P0002';
  end if;

  perform public._write_audit(p_shop_id, 'shop.shipper_remove', 'profile', p_user_id::text);
end
$$;

-- ---------------------------------------------------------------------
-- Owner: plan a trip
--   p_order_ids is in route order.
--   p_trip = { trip_date?, start_lat?, start_lng?, end_mode?, optimizer?, distance_m?,
--              duration_s?, note?, start?: bool }
-- ---------------------------------------------------------------------

create or replace function public.create_trip(
  p_shop_id uuid,
  p_order_ids uuid[],
  p_shipper_id uuid,
  p_trip jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_code text;
  r record;
  v_order uuid;
  v_seq integer := 0;
  v_cod bigint := 0;
  v_lat double precision := (p_trip->>'start_lat')::double precision;
  v_lng double precision := (p_trip->>'start_lng')::double precision;
begin
  if not public.can_manage_shop(p_shop_id) then
    raise exception 'Bạn không có quyền quản lý cửa hàng này' using errcode = '42501';
  end if;
  if p_order_ids is null or cardinality(p_order_ids) = 0 then
    raise exception 'Chọn ít nhất một đơn để giao' using errcode = '22023';
  end if;
  if (select count(distinct x) from unnest(p_order_ids) x) <> cardinality(p_order_ids) then
    raise exception 'Có đơn bị chọn trùng' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.shop_members m
    join public.profiles p on p.id = m.user_id
    where m.shop_id = p_shop_id and m.user_id = p_shipper_id and m.role = 'shipper' and m.active and p.active
  ) then
    raise exception 'Shipper này không thuộc cửa hàng' using errcode = '22023';
  end if;
  if (v_lat is null) <> (v_lng is null) then
    raise exception 'Điểm xuất phát cần có cả vĩ độ và kinh độ' using errcode = '22023';
  end if;

  for r in
    select o.id, o.code, o.status, o.delivery_method, o.cod_amount
    from public.orders o
    where o.shop_id = p_shop_id and o.id = any (p_order_ids)
    order by o.id
    for update of o
  loop
    if r.delivery_method <> 'self' then
      raise exception 'Đơn % không phải đơn tự giao', r.code using errcode = '55000';
    end if;
    if r.status not in ('confirmed', 'failed') then
      raise exception 'Đơn % phải ở trạng thái "Đã xác nhận" hoặc "Giao thất bại"', r.code using errcode = '55000';
    end if;
    if exists (select 1 from public.delivery_stops s where s.order_id = r.id and s.status = 'pending') then
      raise exception 'Đơn % đã nằm trong một chuyến giao khác', r.code using errcode = '55000';
    end if;
    v_cod := v_cod + r.cod_amount;
  end loop;

  if (select count(*) from public.orders where shop_id = p_shop_id and id = any (p_order_ids)) <> cardinality(p_order_ids) then
    raise exception 'Có đơn không thuộc cửa hàng này' using errcode = 'P0002';
  end if;

  v_code := public._next_code(p_shop_id, 'trip', 'CG');
  insert into public.delivery_trips (
    shop_id, code, trip_date, shipper_id, start_lat, start_lng, end_mode, optimizer,
    distance_m, duration_s, cod_expected, note, created_by
  ) values (
    p_shop_id, v_code,
    coalesce((p_trip->>'trip_date')::date, (now() at time zone 'Asia/Ho_Chi_Minh')::date),
    p_shipper_id, v_lat, v_lng,
    coalesce(nullif(p_trip->>'end_mode', ''), 'return'),
    coalesce(nullif(p_trip->>'optimizer', ''), 'manual'),
    (p_trip->>'distance_m')::integer, (p_trip->>'duration_s')::integer, v_cod,
    nullif(btrim(p_trip->>'note'), ''), (select auth.uid())
  )
  returning id into v_id;

  foreach v_order in array p_order_ids loop
    v_seq := v_seq + 1;
    insert into public.delivery_stops (shop_id, trip_id, order_id, seq) values (p_shop_id, v_id, v_order, v_seq);
  end loop;

  if coalesce((p_trip->>'start')::boolean, false) then
    perform public.start_trip(v_id);
  end if;
  return v_id;
end
$$;

-- Owner or the assigned shipper starts the trip: its orders go to "shipping".
create or replace function public.start_trip(p_trip_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.delivery_trips;
  r record;
begin
  select * into t from public.delivery_trips where id = p_trip_id for update;
  if not found then
    raise exception 'Không tìm thấy chuyến giao' using errcode = 'P0002';
  end if;
  if not public._trip_actor_ok(t.shop_id, t.shipper_id) then
    raise exception 'Bạn không có quyền với chuyến giao này' using errcode = '42501';
  end if;
  if t.status <> 'draft' then
    raise exception 'Chuyến giao này không ở trạng thái chưa bắt đầu' using errcode = '55000';
  end if;

  for r in select s.order_id from public.delivery_stops s where s.trip_id = t.id order by s.seq loop
    perform public._apply_order_status(t.shop_id, r.order_id, 'shipping', 'Chuyến ' || t.code);
  end loop;

  update public.delivery_trips set status = 'in_progress', started_at = now() where id = t.id;
end
$$;

create or replace function public.cancel_trip(p_shop_id uuid, p_trip_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_shop(p_shop_id) then
    raise exception 'Bạn không có quyền quản lý cửa hàng này' using errcode = '42501';
  end if;
  perform 1 from public.delivery_trips where id = p_trip_id and shop_id = p_shop_id for update;
  if not found then
    raise exception 'Không tìm thấy chuyến giao' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.delivery_trips where id = p_trip_id and status = 'draft') then
    raise exception 'Chỉ huỷ được chuyến chưa bắt đầu' using errcode = '55000';
  end if;

  delete from public.delivery_stops where trip_id = p_trip_id;
  update public.delivery_trips set status = 'cancelled', cod_expected = 0 where id = p_trip_id;
end
$$;

-- Ends a trip early: stops not yet visited count as failed deliveries.
create or replace function public.finish_trip(p_trip_id uuid, p_reason text default 'Chưa giao kịp')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.delivery_trips;
  r record;
begin
  select * into t from public.delivery_trips where id = p_trip_id for update;
  if not found then
    raise exception 'Không tìm thấy chuyến giao' using errcode = 'P0002';
  end if;
  if not public._trip_actor_ok(t.shop_id, t.shipper_id) then
    raise exception 'Bạn không có quyền với chuyến giao này' using errcode = '42501';
  end if;
  if t.status <> 'in_progress' then
    raise exception 'Chuyến giao này chưa bắt đầu hoặc đã kết thúc' using errcode = '55000';
  end if;

  for r in
    select s.id, s.order_id from public.delivery_stops s
    where s.trip_id = t.id and s.status = 'pending' order by s.seq
  loop
    update public.delivery_stops
    set status = 'failed', fail_reason = left(coalesce(nullif(btrim(p_reason), ''), 'Chưa giao kịp'), 200), done_at = now()
    where id = r.id;
    perform public._apply_order_status(t.shop_id, r.order_id, 'failed', 'Chuyến ' || t.code || ': ' || coalesce(p_reason, 'Chưa giao kịp'));
  end loop;

  perform public._refresh_trip(t.id);
end
$$;

-- Owner confirms the COD money handed over after a finished trip.
create or replace function public.settle_trip(
  p_shop_id uuid,
  p_trip_id uuid,
  p_amount bigint,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.delivery_trips;
begin
  if not public.can_manage_shop(p_shop_id) then
    raise exception 'Bạn không có quyền quản lý cửa hàng này' using errcode = '42501';
  end if;
  select * into t from public.delivery_trips where id = p_trip_id and shop_id = p_shop_id for update;
  if not found then
    raise exception 'Không tìm thấy chuyến giao' using errcode = 'P0002';
  end if;
  if t.status <> 'done' then
    raise exception 'Chỉ đối soát được chuyến đã kết thúc' using errcode = '55000';
  end if;
  if t.settled_at is not null then
    raise exception 'Chuyến này đã được đối soát' using errcode = '55000';
  end if;
  if p_amount is null or p_amount < 0 then
    raise exception 'Số tiền không hợp lệ' using errcode = '22023';
  end if;

  update public.delivery_trips
  set settled_at = now(), settled_by = (select auth.uid()), settled_amount = p_amount,
      settle_note = nullif(btrim(p_note), '')
  where id = t.id;

  perform public._write_audit(p_shop_id, 'trip.settle', 'delivery_trip', t.id::text,
                              jsonb_build_object('expected', t.cod_collected, 'received', p_amount));
end
$$;

-- Fix the location of an order (and of the customer's matching address if it has none).
create or replace function public.set_order_location(
  p_shop_id uuid,
  p_order_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_source text default 'manual'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
begin
  if not public.can_manage_shop(p_shop_id) then
    raise exception 'Bạn không có quyền quản lý cửa hàng này' using errcode = '42501';
  end if;
  if p_lat is null or p_lng is null or abs(p_lat) > 90 or abs(p_lng) > 180 then
    raise exception 'Toạ độ không hợp lệ' using errcode = '22023';
  end if;
  if p_source not in ('gps', 'link', 'manual', 'osm', 'google', 'ors') then
    raise exception 'Nguồn toạ độ không hợp lệ' using errcode = '22023';
  end if;

  select * into o from public.orders where id = p_order_id and shop_id = p_shop_id for update;
  if not found then
    raise exception 'Không tìm thấy đơn hàng' using errcode = 'P0002';
  end if;
  if o.status in ('delivered', 'returned', 'cancelled') then
    raise exception 'Đơn đã hoàn tất, không đổi được vị trí' using errcode = '55000';
  end if;

  update public.orders set ship_lat = p_lat, ship_lng = p_lng where id = o.id;
  update public.customer_addresses
  set lat = p_lat, lng = p_lng, geo_source = p_source, geocoded_at = now()
  where customer_id = o.customer_id and full_text = o.ship_full_text and lat is null;
end
$$;

-- ---------------------------------------------------------------------
-- Shipper: my trips (only what a shipper needs to see)
-- ---------------------------------------------------------------------

create or replace function public.get_my_trips()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(trip order by (trip->>'trip_date') desc, (trip->>'code')), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', t.id, 'code', t.code, 'shop_id', t.shop_id, 'shop_name', sh.name,
      'trip_date', t.trip_date, 'status', t.status, 'started_at', t.started_at,
      'cod_expected', t.cod_expected, 'cod_collected', t.cod_collected,
      'start_lat', t.start_lat, 'start_lng', t.start_lng, 'end_mode', t.end_mode,
      'shop_lat', sh.lat, 'shop_lng', sh.lng, 'note', t.note,
      'stops', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', s.id, 'seq', s.seq, 'status', s.status, 'fail_reason', s.fail_reason,
          'cod_collected', s.cod_collected, 'order_code', o.code,
          'name', o.ship_name, 'phone', o.ship_phone, 'address', o.ship_full_text,
          'lat', o.ship_lat, 'lng', o.ship_lng, 'cod', o.cod_amount,
          'note', o.delivery_note, 'weight_g', o.weight_g,
          'items', (
            select string_agg(
              i.product_name || coalesce(' (' || nullif(i.variant_label, '') || ')', '') || ' x' || i.qty,
              '; ' order by i.product_name, i.variant_label)
            from public.order_items i where i.order_id = o.id
          )
        ) order by s.seq)
        from public.delivery_stops s
        join public.orders o on o.id = s.order_id
        where s.trip_id = t.id
      ), '[]'::jsonb)
    ) as trip
    from public.delivery_trips t
    join public.shops sh on sh.id = t.shop_id
    where t.shipper_id = (select auth.uid())
      and (t.status in ('draft', 'in_progress')
           or (t.status = 'done' and t.finished_at > now() - interval '1 day'))
      and public._trip_actor_ok(t.shop_id, t.shipper_id)
  ) x
$$;

create or replace function public.get_my_trip_history(p_limit integer default 30)
returns table (
  id uuid,
  code text,
  shop_name text,
  trip_date date,
  status text,
  stops integer,
  delivered integer,
  failed integer,
  cod_collected bigint,
  settled_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.code, sh.name, t.trip_date, t.status,
         (select count(*)::integer from public.delivery_stops s where s.trip_id = t.id),
         (select count(*)::integer from public.delivery_stops s where s.trip_id = t.id and s.status = 'delivered'),
         (select count(*)::integer from public.delivery_stops s where s.trip_id = t.id and s.status = 'failed'),
         t.cod_collected, t.settled_at
  from public.delivery_trips t
  join public.shops sh on sh.id = t.shop_id
  where t.shipper_id = (select auth.uid())
    and t.status in ('done', 'cancelled')
    and public._trip_actor_ok(t.shop_id, t.shipper_id)
  order by t.trip_date desc, t.created_at desc
  limit greatest(least(p_limit, 100), 1)
$$;

-- ---------------------------------------------------------------------
-- Shipper (or owner): record a result
-- ---------------------------------------------------------------------

create or replace function public.complete_stop(
  p_stop_id uuid,
  p_cod bigint default null,
  p_lat double precision default null,
  p_lng double precision default null,
  p_photo text default null,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.delivery_stops;
  t public.delivery_trips;
  o public.orders;
  v_cod bigint;
begin
  select * into s from public.delivery_stops where id = p_stop_id for update;
  if not found then
    raise exception 'Không tìm thấy điểm giao' using errcode = 'P0002';
  end if;
  select * into t from public.delivery_trips where id = s.trip_id for update;
  if not public._trip_actor_ok(t.shop_id, t.shipper_id) then
    raise exception 'Bạn không có quyền với chuyến giao này' using errcode = '42501';
  end if;
  if t.status <> 'in_progress' then
    raise exception 'Chuyến giao chưa bắt đầu hoặc đã kết thúc' using errcode = '55000';
  end if;
  if s.status <> 'pending' then
    raise exception 'Điểm giao này đã có kết quả' using errcode = '55000';
  end if;
  if (p_lat is null) <> (p_lng is null) then
    raise exception 'Toạ độ cần có cả vĩ độ và kinh độ' using errcode = '22023';
  end if;
  if p_photo is not null and p_photo not like t.shop_id::text || '/%' then
    raise exception 'Đường dẫn ảnh không hợp lệ' using errcode = '22023';
  end if;

  select * into o from public.orders where id = s.order_id for update;
  v_cod := coalesce(p_cod, o.cod_amount);
  if v_cod < 0 then
    raise exception 'Số tiền thu không hợp lệ' using errcode = '22023';
  end if;

  update public.delivery_stops
  set status = 'delivered', cod_collected = v_cod, proof_photo_path = p_photo,
      note = nullif(btrim(p_note), ''), done_at = now(), done_lat = p_lat, done_lng = p_lng
  where id = s.id;

  perform public._apply_order_status(t.shop_id, o.id, 'delivered', 'Chuyến ' || t.code);

  -- The first successful delivery fixes the customer's location with the shipper's GPS.
  if p_lat is not null and o.ship_lat is null then
    update public.orders set ship_lat = p_lat, ship_lng = p_lng where id = o.id;
    update public.customer_addresses
    set lat = p_lat, lng = p_lng, geo_source = 'gps', geocoded_at = now()
    where customer_id = o.customer_id and full_text = o.ship_full_text and lat is null;
  end if;

  perform public._refresh_trip(t.id);
end
$$;

create or replace function public.fail_stop(p_stop_id uuid, p_reason text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.delivery_stops;
  t public.delivery_trips;
begin
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Chọn lý do giao không thành công' using errcode = '22023';
  end if;
  select * into s from public.delivery_stops where id = p_stop_id for update;
  if not found then
    raise exception 'Không tìm thấy điểm giao' using errcode = 'P0002';
  end if;
  select * into t from public.delivery_trips where id = s.trip_id for update;
  if not public._trip_actor_ok(t.shop_id, t.shipper_id) then
    raise exception 'Bạn không có quyền với chuyến giao này' using errcode = '42501';
  end if;
  if t.status <> 'in_progress' then
    raise exception 'Chuyến giao chưa bắt đầu hoặc đã kết thúc' using errcode = '55000';
  end if;
  if s.status <> 'pending' then
    raise exception 'Điểm giao này đã có kết quả' using errcode = '55000';
  end if;

  update public.delivery_stops
  set status = 'failed', fail_reason = left(btrim(p_reason), 200), note = nullif(btrim(p_note), ''), done_at = now()
  where id = s.id;
  perform public._apply_order_status(t.shop_id, s.order_id, 'failed',
                                     'Chuyến ' || t.code || ': ' || btrim(p_reason));
  perform public._refresh_trip(t.id);
end
$$;

select public._apply_grants();
