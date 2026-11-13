-- =====================================================================
-- M3 · Orders
--
--   * Orders are created/edited only through save_order() and change state
--     only through set_order_status(); both run in one transaction, so the
--     status, the stock ledger, the event log and the customer's counters
--     always agree.
--   * Stock is deducted when an order is confirmed and given back when it is
--     cancelled, re-opened or returned (orders.stock_deducted remembers it).
--   * Name, phone and address are copied onto the order (ship_*), so editing
--     a customer later never changes old orders.
-- =====================================================================

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  code text not null,
  customer_id uuid references public.customers (id) on delete set null,

  ship_name text,
  ship_phone text,
  ship_detail text,
  ship_province_code text references public.provinces (code),
  ship_ward_code text references public.wards (code),
  ship_ward_text text,
  ship_full_text text,
  ship_lat double precision check (ship_lat between -90 and 90),
  ship_lng double precision check (ship_lng between -180 and 180),
  ship_search text generated always as (
    public.vn_search_key(coalesce(ship_name, '') || ' ' || coalesce(ship_phone, '') || ' ' || code)
  ) stored,

  status text not null default 'new' check (status in (
    'new', 'confirmed', 'vtp_exported', 'shipping', 'delivered',
    'failed', 'returning', 'returned', 'cancelled'
  )),
  delivery_method text not null check (delivery_method in ('self', 'vtp', 'pickup')),

  subtotal bigint not null default 0 check (subtotal >= 0),
  shipping_fee bigint not null default 0 check (shipping_fee >= 0),
  discount bigint not null default 0 check (discount >= 0),
  total bigint not null default 0 check (total >= 0),
  paid_amount bigint not null default 0 check (paid_amount >= 0),
  cod_amount bigint not null default 0 check (cod_amount >= 0),
  weight_g integer not null default 0 check (weight_g >= 0),

  delivery_note text check (delivery_note is null or length(delivery_note) <= 500),
  internal_note text check (internal_note is null or length(internal_note) <= 1000),

  vtp_service text,
  vtp_fee_payer text check (vtp_fee_payer is null or vtp_fee_payer in ('sender', 'receiver')),
  vtp_delivery_requirement text check (vtp_delivery_requirement is null or vtp_delivery_requirement in ('no_view', 'view', 'try')),
  vtp_tracking_code text,
  vtp_batch_id uuid,

  stock_deducted boolean not null default false,
  confirmed_at timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (shop_id, code),
  check (paid_amount <= total),
  check ((ship_lat is null) = (ship_lng is null))
);

create index orders_shop_status_idx on public.orders (shop_id, status, created_at desc);
create index orders_shop_created_idx on public.orders (shop_id, created_at desc);
create index orders_customer_idx on public.orders (customer_id);
create index orders_search_trgm on public.orders using gin (ship_search extensions.gin_trgm_ops);

create trigger orders_updated_at before update on public.orders
  for each row execute function public.tg_set_updated_at();

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  variant_id uuid not null references public.product_variants (id),
  product_name text not null,
  variant_label text not null default '',
  sku text not null,
  unit_cost bigint not null default 0 check (unit_cost >= 0),
  weight_g integer not null default 0 check (weight_g >= 0),
  qty integer not null check (qty > 0),
  unit_price bigint not null check (unit_price >= 0)
);

create index order_items_order_idx on public.order_items (order_id);
create index order_items_variant_idx on public.order_items (variant_id);

create table public.order_events (
  id bigint generated always as identity primary key,
  shop_id uuid not null references public.shops (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  from_status text,
  to_status text not null,
  note text,
  actor_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index order_events_order_idx on public.order_events (order_id, id);

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_events enable row level security;

create policy orders_select on public.orders
  for select to authenticated using (public.can_manage_shop(shop_id));
create policy order_items_select on public.order_items
  for select to authenticated using (public.can_manage_shop(shop_id));
create policy order_events_select on public.order_events
  for select to authenticated using (public.can_manage_shop(shop_id));

-- ---------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------

-- Which status changes are allowed at all.
create or replace function public._order_transition_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_from
    when 'new' then p_to in ('confirmed', 'cancelled')
    when 'confirmed' then p_to in ('new', 'cancelled', 'vtp_exported', 'shipping', 'delivered')
    when 'vtp_exported' then p_to in ('confirmed', 'shipping', 'delivered', 'cancelled')
    when 'shipping' then p_to in ('delivered', 'failed', 'returning')
    when 'failed' then p_to in ('shipping', 'returning')
    when 'returning' then p_to in ('returned')
    else false
  end
$$;

-- Customer counters are recomputed from the orders, so they can never drift.
create or replace function public._refresh_customer_stats(p_customer_id uuid)
returns void
language sql
set search_path = ''
as $$
  update public.customers c
  set order_count = s.orders,
      delivered_count = s.delivered,
      returned_count = s.returned,
      total_spent = s.spent
  from (
    select count(*) filter (where o.status <> 'cancelled')::integer as orders,
           count(*) filter (where o.status = 'delivered')::integer as delivered,
           count(*) filter (where o.status in ('returning', 'returned'))::integer as returned,
           coalesce(sum(o.total) filter (where o.status = 'delivered'), 0)::bigint as spent
    from public.orders o
    where o.customer_id = p_customer_id
  ) s
  where c.id = p_customer_id
$$;

-- Put the goods of an order back in stock (cancel / reopen / return).
create or replace function public._restore_order_stock(
  p_shop_id uuid,
  p_order_id uuid,
  p_code text,
  p_type text,
  p_note text
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select i.variant_id, sum(i.qty)::integer as qty, max(i.unit_cost) as unit_cost
    from public.order_items i
    where i.order_id = p_order_id
    group by i.variant_id
    order by i.variant_id
  loop
    perform public._apply_stock_change(
      p_shop_id, r.variant_id, r.qty, p_type, r.unit_cost, 'order', p_order_id,
      concat_ws(' · ', p_code, p_note), true
    );
  end loop;
  update public.orders set stock_deducted = false where id = p_order_id;
end
$$;

-- Take the goods out of stock. Fails (and rolls everything back) when stock is short.
create or replace function public._deduct_order_stock(p_shop_id uuid, p_order_id uuid, p_code text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  r record;
  v_allow boolean;
begin
  select coalesce(s.allow_negative_stock, false) into v_allow
  from public.shop_settings s where s.shop_id = p_shop_id;

  for r in
    select i.variant_id, sum(i.qty)::integer as qty, max(i.unit_cost) as unit_cost
    from public.order_items i
    where i.order_id = p_order_id
    group by i.variant_id
    order by i.variant_id
  loop
    perform public._apply_stock_change(
      p_shop_id, r.variant_id, -r.qty, 'order_out', r.unit_cost, 'order', p_order_id, p_code,
      coalesce(v_allow, false)
    );
  end loop;
  update public.orders set stock_deducted = true where id = p_order_id;
end
$$;

-- Moves an order to a new status with all side effects. No permission check:
-- callers (set_order_status, VTP and delivery functions) do their own.
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

-- ---------------------------------------------------------------------
-- RPC: create or edit an order (only while status = new)
--
-- p_order = {
--   id?, customer_id?, delivery_method: self|vtp|pickup, confirm?: bool,
--   ship: { name, phone, detail, province_code, ward_code, ward_text, lat, lng },
--   save_address?: bool,
--   items: [{ variant_id, qty, unit_price? }],
--   shipping_fee, discount, paid_amount, weight_g?,
--   delivery_note, internal_note,
--   vtp_service, vtp_fee_payer, vtp_delivery_requirement
-- }
-- ---------------------------------------------------------------------

create or replace function public.save_order(p_shop_id uuid, p_order jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := nullif(p_order->>'id', '')::uuid;
  v_method text := coalesce(nullif(p_order->>'delivery_method', ''), 'self');
  v_ship jsonb := coalesce(p_order->'ship', '{}'::jsonb);
  v_name text := nullif(btrim(v_ship->>'name'), '');
  v_phone text := public.normalize_vn_mobile(v_ship->>'phone');
  v_detail text := nullif(btrim(v_ship->>'detail'), '');
  v_province text := nullif(v_ship->>'province_code', '');
  v_ward text := nullif(v_ship->>'ward_code', '');
  v_ward_text text := nullif(btrim(v_ship->>'ward_text'), '');
  v_lat double precision := (v_ship->>'lat')::double precision;
  v_lng double precision := (v_ship->>'lng')::double precision;
  v_customer uuid := nullif(p_order->>'customer_id', '')::uuid;
  v_settings public.shop_settings;
  v_current public.orders;
  r record;
  v public.product_variants;
  v_product_name text;
  v_price bigint;
  v_lines jsonb := '[]'::jsonb;
  v_subtotal bigint := 0;
  v_weight integer := 0;
  v_shipping bigint := greatest(coalesce((p_order->>'shipping_fee')::bigint, 0), 0);
  v_discount bigint := greatest(coalesce((p_order->>'discount')::bigint, 0), 0);
  v_paid bigint := greatest(coalesce((p_order->>'paid_amount')::bigint, 0), 0);
  v_total bigint;
  v_full_text text;
  v_code text;
  v_prefix text;
begin
  if not public.can_manage_shop(p_shop_id) then
    raise exception 'Bạn không có quyền quản lý cửa hàng này' using errcode = '42501';
  end if;
  if v_method not in ('self', 'vtp', 'pickup') then
    raise exception 'Phương thức giao hàng không hợp lệ' using errcode = '22023';
  end if;
  if jsonb_typeof(p_order->'items') is distinct from 'array' or jsonb_array_length(p_order->'items') = 0 then
    raise exception 'Đơn hàng cần ít nhất một sản phẩm' using errcode = '22023';
  end if;
  if btrim(coalesce(v_ship->>'phone', '')) <> '' and v_phone is null then
    raise exception 'Số điện thoại người nhận không hợp lệ' using errcode = '22023';
  end if;
  if v_method <> 'pickup' then
    if v_name is null then raise exception 'Nhập tên người nhận' using errcode = '22023'; end if;
    if v_phone is null then raise exception 'Nhập số điện thoại người nhận' using errcode = '22023'; end if;
    if v_detail is null then raise exception 'Nhập địa chỉ giao hàng' using errcode = '22023'; end if;
    if v_province is null then raise exception 'Chọn tỉnh/thành của địa chỉ giao hàng' using errcode = '22023'; end if;
  end if;
  if v_province is not null and not exists (select 1 from public.provinces where code = v_province) then
    raise exception 'Không tìm thấy tỉnh/thành' using errcode = '22023';
  end if;
  if v_ward is not null and not exists (
    select 1 from public.wards where code = v_ward and province_code is not distinct from v_province
  ) then
    raise exception 'Xã/phường không thuộc tỉnh/thành đã chọn' using errcode = '22023';
  end if;
  if (v_lat is null) <> (v_lng is null) then
    raise exception 'Toạ độ cần có cả vĩ độ và kinh độ' using errcode = '22023';
  end if;

  select * into v_settings from public.shop_settings where shop_id = p_shop_id;

  if v_id is not null then
    select * into v_current from public.orders where id = v_id and shop_id = p_shop_id for update;
    if not found then
      raise exception 'Không tìm thấy đơn hàng' using errcode = 'P0002';
    end if;
    if v_current.status <> 'new' then
      raise exception 'Chỉ sửa được đơn ở trạng thái Mới. Hãy bấm "Mở lại đơn" trước.' using errcode = '55000';
    end if;
  end if;

  -- Customer: use the given one, or find / create by phone.
  if v_customer is not null then
    if not exists (select 1 from public.customers where id = v_customer and shop_id = p_shop_id) then
      raise exception 'Không tìm thấy khách hàng' using errcode = 'P0002';
    end if;
  elsif v_phone is not null then
    select id into v_customer from public.customers where shop_id = p_shop_id and phone = v_phone;
    if not found then
      insert into public.customers (shop_id, name, phone)
      values (p_shop_id, coalesce(v_name, 'Khách lẻ'), v_phone)
      returning id into v_customer;
    end if;
  end if;

  -- Lines: validate, merge duplicates, snapshot names / cost / weight.
  for r in
    select x.variant_id, sum(x.qty)::integer as qty, x.unit_price
    from jsonb_to_recordset(p_order->'items') as x(variant_id uuid, qty integer, unit_price bigint)
    group by x.variant_id, x.unit_price
    order by x.variant_id
  loop
    if r.qty is null or r.qty <= 0 then
      raise exception 'Số lượng phải lớn hơn 0' using errcode = '22023';
    end if;
    select * into v from public.product_variants where id = r.variant_id and shop_id = p_shop_id;
    if not found then
      raise exception 'Không tìm thấy sản phẩm trong cửa hàng' using errcode = 'P0002';
    end if;
    select p.name into v_product_name from public.products p where p.id = v.product_id;
    if not v.active then
      raise exception '% đã ngừng bán', concat_ws(' ', v_product_name, nullif(v.variant_label, ''))
        using errcode = '22023';
    end if;
    v_price := coalesce(r.unit_price, v.price);
    if v_price < 0 then
      raise exception 'Đơn giá không hợp lệ' using errcode = '22023';
    end if;
    v_subtotal := v_subtotal + r.qty * v_price;
    v_weight := v_weight + r.qty * v.weight_g;
    v_lines := v_lines || jsonb_build_object(
      'variant_id', v.id, 'product_name', v_product_name, 'variant_label', v.variant_label,
      'sku', v.sku, 'unit_cost', v.cost, 'weight_g', v.weight_g, 'qty', r.qty, 'unit_price', v_price
    );
  end loop;

  if v_discount > v_subtotal + v_shipping then
    raise exception 'Giảm giá không được lớn hơn tổng tiền hàng' using errcode = '22023';
  end if;
  v_total := v_subtotal + v_shipping - v_discount;
  if v_paid > v_total then
    raise exception 'Số tiền đã thanh toán không được lớn hơn tổng đơn' using errcode = '22023';
  end if;
  v_weight := coalesce(nullif((p_order->>'weight_g')::integer, 0), v_weight + coalesce(v_settings.packaging_weight_g, 0));

  v_full_text := public._address_text(v_detail, v_ward, v_ward_text, v_province);

  if v_id is null then
    select order_prefix into v_prefix from public.shops where id = p_shop_id;
    v_code := public._next_code(p_shop_id, 'order', v_prefix);
    insert into public.orders (
      shop_id, code, customer_id, ship_name, ship_phone, ship_detail, ship_province_code,
      ship_ward_code, ship_ward_text, ship_full_text, ship_lat, ship_lng, delivery_method,
      subtotal, shipping_fee, discount, total, paid_amount, cod_amount, weight_g,
      delivery_note, internal_note, vtp_service, vtp_fee_payer, vtp_delivery_requirement, created_by
    ) values (
      p_shop_id, v_code, v_customer, v_name, v_phone, v_detail, v_province,
      v_ward, case when v_ward is null then v_ward_text end, v_full_text, v_lat, v_lng, v_method,
      v_subtotal, v_shipping, v_discount, v_total, v_paid, v_total - v_paid, v_weight,
      nullif(btrim(p_order->>'delivery_note'), ''), nullif(btrim(p_order->>'internal_note'), ''),
      coalesce(nullif(p_order->>'vtp_service', ''), v_settings.vtp_service),
      coalesce(nullif(p_order->>'vtp_fee_payer', ''), v_settings.vtp_fee_payer),
      coalesce(nullif(p_order->>'vtp_delivery_requirement', ''), v_settings.vtp_delivery_requirement),
      (select auth.uid())
    )
    returning id into v_id;

    insert into public.order_events (shop_id, order_id, from_status, to_status, actor_id)
    values (p_shop_id, v_id, null, 'new', (select auth.uid()));
  else
    update public.orders
    set customer_id = v_customer, ship_name = v_name, ship_phone = v_phone, ship_detail = v_detail,
        ship_province_code = v_province, ship_ward_code = v_ward,
        ship_ward_text = case when v_ward is null then v_ward_text end,
        ship_full_text = v_full_text, ship_lat = v_lat, ship_lng = v_lng, delivery_method = v_method,
        subtotal = v_subtotal, shipping_fee = v_shipping, discount = v_discount, total = v_total,
        paid_amount = v_paid, cod_amount = v_total - v_paid, weight_g = v_weight,
        delivery_note = nullif(btrim(p_order->>'delivery_note'), ''),
        internal_note = nullif(btrim(p_order->>'internal_note'), ''),
        vtp_service = coalesce(nullif(p_order->>'vtp_service', ''), vtp_service),
        vtp_fee_payer = coalesce(nullif(p_order->>'vtp_fee_payer', ''), vtp_fee_payer),
        vtp_delivery_requirement = coalesce(nullif(p_order->>'vtp_delivery_requirement', ''), vtp_delivery_requirement)
    where id = v_id;
    delete from public.order_items where order_id = v_id;
    -- Customer counters of the previous customer, if it changed.
    if v_current.customer_id is distinct from v_customer and v_current.customer_id is not null then
      perform public._refresh_customer_stats(v_current.customer_id);
    end if;
  end if;

  insert into public.order_items (
    shop_id, order_id, variant_id, product_name, variant_label, sku, unit_cost, weight_g, qty, unit_price
  )
  select p_shop_id, v_id, x.variant_id, x.product_name, x.variant_label, x.sku, x.unit_cost,
         x.weight_g, x.qty, x.unit_price
  from jsonb_to_recordset(v_lines) as x(
    variant_id uuid, product_name text, variant_label text, sku text, unit_cost bigint,
    weight_g integer, qty integer, unit_price bigint
  );

  -- Remember the address on the customer (once per distinct address).
  if v_customer is not null and v_detail is not null and v_province is not null
     and coalesce((p_order->>'save_address')::boolean, false) then
    if exists (select 1 from public.customer_addresses where customer_id = v_customer and full_text = v_full_text) then
      if v_lat is not null then
        update public.customer_addresses
        set lat = v_lat, lng = v_lng, geo_source = coalesce(nullif(v_ship->>'geo_source', ''), 'manual'),
            geocoded_at = now()
        where customer_id = v_customer and full_text = v_full_text and lat is null;
      end if;
    else
      insert into public.customer_addresses (
        shop_id, customer_id, detail, province_code, ward_code, ward_text, full_text, lat, lng,
        geo_source, geocoded_at, is_default
      ) values (
        p_shop_id, v_customer, v_detail, v_province, v_ward, case when v_ward is null then v_ward_text end,
        v_full_text, v_lat, v_lng, case when v_lat is not null then coalesce(nullif(v_ship->>'geo_source', ''), 'manual') end,
        case when v_lat is not null then now() end,
        not exists (select 1 from public.customer_addresses where customer_id = v_customer)
      );
    end if;
  end if;

  if coalesce((p_order->>'confirm')::boolean, false) then
    perform public._apply_order_status(p_shop_id, v_id, 'confirmed', null);
  end if;

  if v_customer is not null then
    perform public._refresh_customer_stats(v_customer);
  end if;
  return v_id;
end
$$;

-- ---------------------------------------------------------------------
-- RPC: change the status of an order
--   Handled here: confirmed, new (reopen), cancelled, shipping, delivered,
--   failed, returning, returned. "vtp_exported" is set by the export batch.
-- ---------------------------------------------------------------------

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

-- Number of orders per status, for the tabs of the order list.
create or replace function public.order_status_counts(p_shop_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_shop(p_shop_id) then
    raise exception 'Bạn không có quyền quản lý cửa hàng này' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_object_agg(status, n)
    from (select status, count(*) as n from public.orders where shop_id = p_shop_id group by status) s
  ), '{}'::jsonb);
end
$$;

select public._apply_grants();
