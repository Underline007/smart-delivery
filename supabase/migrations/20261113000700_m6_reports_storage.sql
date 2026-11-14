-- =====================================================================
-- M6 · Dashboard, reports, file storage
--
--   * Storage buckets: product-images (public read, owners write) and
--     delivery-proofs (private; shippers of the shop upload, owners read).
--     File paths start with the shop id, and that is what policies check.
--     Skipped when the "storage" schema does not exist (plain Postgres).
--   * Reports count money on DELIVERED orders, by delivery date (Vietnam time).
--     Gross profit = (subtotal − discount) − Σ(qty × unit cost); the shipping
--     fee is not income.
-- =====================================================================

-- Shop id found in the first folder of a storage path, or null.
create or replace function public.storage_path_shop(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then split_part(p_name, '/', 1)::uuid
  end
$$;

do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public)
    values ('product-images', 'product-images', true), ('delivery-proofs', 'delivery-proofs', false)
    on conflict (id) do nothing;

    -- Product images: owners / admin of the shop manage them; everyone can read (public bucket).
    create policy product_images_write on storage.objects
      for all to authenticated
      using (bucket_id = 'product-images' and public.can_manage_shop(public.storage_path_shop(name)))
      with check (bucket_id = 'product-images' and public.can_manage_shop(public.storage_path_shop(name)));

    -- Delivery proofs: members of the shop (shippers) may upload new files (never overwrite);
    -- only owners / admin read or delete them. File names must therefore be unique.
    create policy delivery_proofs_insert on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'delivery-proofs'
        and (public.is_shop_member(public.storage_path_shop(name)) or public.is_admin())
      );
    create policy delivery_proofs_select on storage.objects
      for select to authenticated
      using (bucket_id = 'delivery-proofs' and public.can_manage_shop(public.storage_path_shop(name)));
    create policy delivery_proofs_delete on storage.objects
      for delete to authenticated
      using (bucket_id = 'delivery-proofs' and public.can_manage_shop(public.storage_path_shop(name)));
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- Dashboard (owner home)
-- ---------------------------------------------------------------------

create or replace function public.dashboard_summary(p_shop_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v jsonb;
begin
  if not public.can_manage_shop(p_shop_id) then
    raise exception 'Bạn không có quyền quản lý cửa hàng này' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'today', v_today,
    'orders_created', count(*) filter (where (o.created_at at time zone 'Asia/Ho_Chi_Minh')::date = v_today and o.status <> 'cancelled'),
    'revenue_created', coalesce(sum(o.total) filter (where (o.created_at at time zone 'Asia/Ho_Chi_Minh')::date = v_today and o.status <> 'cancelled'), 0),
    'delivered_today', count(*) filter (where o.status = 'delivered' and (o.delivered_at at time zone 'Asia/Ho_Chi_Minh')::date = v_today),
    'revenue_delivered_today', coalesce(sum(o.total) filter (where o.status = 'delivered' and (o.delivered_at at time zone 'Asia/Ho_Chi_Minh')::date = v_today), 0),
    'to_process', count(*) filter (where o.status in ('new', 'confirmed', 'vtp_exported')),
    'new_orders', count(*) filter (where o.status = 'new'),
    'shipping', count(*) filter (where o.status = 'shipping'),
    'failed', count(*) filter (where o.status = 'failed'),
    'returning', count(*) filter (where o.status = 'returning'),
    'cod_on_the_road', coalesce(sum(o.cod_amount) filter (where o.status = 'shipping'), 0),
    'vtp_waiting_tracking', count(*) filter (where o.status = 'vtp_exported' and o.updated_at < now() - interval '2 days')
  ) into v
  from public.orders o
  where o.shop_id = p_shop_id;

  return v || jsonb_build_object(
    'low_stock', (
      select count(*) from public.product_variants x
      join public.products p on p.id = x.product_id
      where x.shop_id = p_shop_id and x.active and p.active
        and x.low_stock_threshold > 0 and x.stock_qty <= x.low_stock_threshold
    ),
    'unsettled_trips', (
      select count(*) from public.delivery_trips t
      where t.shop_id = p_shop_id and t.status = 'done' and t.settled_at is null
    ),
    'unsettled_cod', coalesce((
      select sum(t.cod_collected) from public.delivery_trips t
      where t.shop_id = p_shop_id and t.status = 'done' and t.settled_at is null
    ), 0),
    'active_trips', (
      select count(*) from public.delivery_trips t
      where t.shop_id = p_shop_id and t.status in ('draft', 'in_progress')
    )
  );
end
$$;

-- ---------------------------------------------------------------------
-- Sales report for a date range (inclusive, Vietnam time)
-- ---------------------------------------------------------------------

create or replace function public.sales_report(p_shop_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from timestamptz := (p_from::timestamp at time zone 'Asia/Ho_Chi_Minh');
  v_to timestamptz := ((p_to + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh');
begin
  if not public.can_manage_shop(p_shop_id) then
    raise exception 'Bạn không có quyền quản lý cửa hàng này' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Khoảng ngày không hợp lệ' using errcode = '22023';
  end if;
  if p_to - p_from > 366 then
    raise exception 'Chọn khoảng tối đa 1 năm' using errcode = '22023';
  end if;

  return (
    with delivered as (
      select o.*,
             (select coalesce(sum(i.qty * i.unit_cost), 0) from public.order_items i where i.order_id = o.id) as cost
      from public.orders o
      where o.shop_id = p_shop_id and o.status = 'delivered'
        and o.delivered_at >= v_from and o.delivered_at < v_to
    ),
    created as (
      select o.* from public.orders o
      where o.shop_id = p_shop_id and o.created_at >= v_from and o.created_at < v_to
    )
    select jsonb_build_object(
      'from', p_from,
      'to', p_to,
      'totals', jsonb_build_object(
        'orders_created', (select count(*) from created where status <> 'cancelled'),
        'cancelled', (select count(*) from created where status = 'cancelled'),
        'delivered', (select count(*) from delivered),
        'returned', (select count(*) from created where status in ('returning', 'returned')),
        'revenue', coalesce((select sum(total) from delivered), 0),
        'goods_revenue', coalesce((select sum(subtotal - discount) from delivered), 0),
        'cost', coalesce((select sum(cost) from delivered), 0),
        'gross_profit', coalesce((select sum(subtotal - discount - cost) from delivered), 0)
      ),
      'by_day', coalesce((
        select jsonb_agg(jsonb_build_object('day', d.day, 'orders', d.orders, 'revenue', d.revenue) order by d.day)
        from (
          select (delivered_at at time zone 'Asia/Ho_Chi_Minh')::date as day, count(*) as orders, sum(total) as revenue
          from delivered group by 1
        ) d
      ), '[]'::jsonb),
      'top_products', coalesce((
        select jsonb_agg(jsonb_build_object('name', t.name, 'qty', t.qty, 'revenue', t.revenue, 'profit', t.profit) order by t.revenue desc, t.name)
        from (
          select i.product_name as name, sum(i.qty) as qty, sum(i.qty * i.unit_price) as revenue,
                 sum(i.qty * (i.unit_price - i.unit_cost)) as profit
          from public.order_items i join delivered d on d.id = i.order_id
          group by i.product_name order by sum(i.qty * i.unit_price) desc limit 10
        ) t
      ), '[]'::jsonb),
      'top_variants', coalesce((
        select jsonb_agg(jsonb_build_object('name', t.name, 'sku', t.sku, 'qty', t.qty, 'revenue', t.revenue) order by t.qty desc, t.name)
        from (
          select i.product_name || coalesce(' (' || nullif(i.variant_label, '') || ')', '') as name, i.sku,
                 sum(i.qty) as qty, sum(i.qty * i.unit_price) as revenue
          from public.order_items i join delivered d on d.id = i.order_id
          group by i.product_name, i.variant_label, i.sku order by sum(i.qty) desc limit 10
        ) t
      ), '[]'::jsonb),
      'top_customers', coalesce((
        select jsonb_agg(jsonb_build_object('name', t.name, 'phone', t.phone, 'orders', t.orders, 'spent', t.spent) order by t.spent desc, t.name)
        from (
          select coalesce(max(d.ship_name), 'Khách lẻ') as name, max(d.ship_phone) as phone, count(*) as orders, sum(d.total) as spent
          from delivered d group by coalesce(d.customer_id::text, d.ship_phone) order by sum(d.total) desc limit 10
        ) t
      ), '[]'::jsonb),
      'by_method', coalesce((
        select jsonb_agg(jsonb_build_object('method', m.method, 'orders', m.orders, 'delivered', m.delivered, 'returned', m.returned) order by m.method)
        from (
          select c.delivery_method as method,
                 count(*) filter (where c.status <> 'cancelled') as orders,
                 count(*) filter (where c.status = 'delivered') as delivered,
                 count(*) filter (where c.status in ('returning', 'returned')) as returned
          from created c group by c.delivery_method
        ) m
      ), '[]'::jsonb),
      'shippers', coalesce((
        select jsonb_agg(jsonb_build_object(
          'name', s.name, 'trips', s.trips, 'delivered', s.delivered, 'failed', s.failed, 'cod_collected', s.cod
        ) order by s.delivered desc)
        from (
          select p.full_name as name, count(distinct t.id) as trips,
                 count(*) filter (where st.status = 'delivered') as delivered,
                 count(*) filter (where st.status = 'failed') as failed,
                 coalesce(sum(st.cod_collected) filter (where st.status = 'delivered'), 0) as cod
          from public.delivery_trips t
          join public.profiles p on p.id = t.shipper_id
          join public.delivery_stops st on st.trip_id = t.id
          where t.shop_id = p_shop_id and t.trip_date between p_from and p_to and t.status <> 'cancelled'
          group by p.full_name
        ) s
      ), '[]'::jsonb)
    )
  );
end
$$;

-- ---------------------------------------------------------------------
-- Admin: last 30 days per shop
-- ---------------------------------------------------------------------

create or replace function public.admin_shop_summary()
returns table (
  shop_id uuid,
  name text,
  active boolean,
  orders_30d bigint,
  delivered_30d bigint,
  revenue_30d bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Chỉ admin được xem tổng hợp' using errcode = '42501';
  end if;
  return query
  select s.id, s.name, s.active,
         count(o.id) filter (where o.created_at > now() - interval '30 days' and o.status <> 'cancelled'),
         count(o.id) filter (where o.status = 'delivered' and o.delivered_at > now() - interval '30 days'),
         coalesce(sum(o.total) filter (where o.status = 'delivered' and o.delivered_at > now() - interval '30 days'), 0)::bigint
  from public.shops s
  left join public.orders o on o.shop_id = s.id
  group by s.id, s.name, s.active
  order by s.active desc, s.name;
end
$$;

select public._apply_grants();
