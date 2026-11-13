-- =====================================================================
-- M1 · Shop settings, products with variants, stock ledger
--
--   * Every product has >= 1 variant (a hidden default one when the product
--     has no options). Stock is tracked per variant.
--   * stock_movements is the source of truth; product_variants.stock_qty is
--     a cache updated in the same transaction by _apply_stock_change().
--   * Variants are never deleted, only deactivated, to keep history.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Per-shop settings
-- ---------------------------------------------------------------------

create table public.shop_settings (
  shop_id uuid primary key references public.shops (id) on delete cascade,
  vtp_service text not null default 'VCN' check (length(vtp_service) <= 20),
  vtp_fee_payer text not null default 'sender' check (vtp_fee_payer in ('sender', 'receiver')),
  vtp_delivery_requirement text not null default 'no_view'
    check (vtp_delivery_requirement in ('no_view', 'view', 'try')),
  packaging_weight_g integer not null default 100 check (packaging_weight_g >= 0),
  allow_negative_stock boolean not null default false,
  message_template text not null default
    E'Chào {ten}, shop xác nhận đơn {ma_don}:\n{san_pham}\nTổng cộng: {tong}đ (thu hộ {cod}đ)\nĐịa chỉ: {dia_chi}\nCảm ơn bạn!'
    check (length(message_template) <= 2000),
  updated_at timestamptz not null default now()
);

create trigger shop_settings_updated_at before update on public.shop_settings
  for each row execute function public.tg_set_updated_at();

create or replace function public.tg_create_shop_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.shop_settings (shop_id) values (new.id) on conflict do nothing;
  return new;
end
$$;

create trigger shops_create_settings after insert on public.shops
  for each row execute function public.tg_create_shop_settings();

insert into public.shop_settings (shop_id) select id from public.shops on conflict do nothing;

alter table public.shop_settings enable row level security;

create policy shop_settings_select on public.shop_settings
  for select to authenticated
  using (public.can_manage_shop(shop_id));

create or replace function public.save_shop_settings(p_shop_id uuid, p_settings jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_shop(p_shop_id) then
    raise exception 'Bạn không có quyền quản lý cửa hàng này' using errcode = '42501';
  end if;

  insert into public.shop_settings (shop_id) values (p_shop_id) on conflict do nothing;

  update public.shop_settings s
  set vtp_service = coalesce(nullif(btrim(p_settings->>'vtp_service'), ''), s.vtp_service),
      vtp_fee_payer = coalesce(p_settings->>'vtp_fee_payer', s.vtp_fee_payer),
      vtp_delivery_requirement =
        coalesce(p_settings->>'vtp_delivery_requirement', s.vtp_delivery_requirement),
      packaging_weight_g = coalesce((p_settings->>'packaging_weight_g')::integer, s.packaging_weight_g),
      allow_negative_stock =
        coalesce((p_settings->>'allow_negative_stock')::boolean, s.allow_negative_stock),
      message_template = coalesce(nullif(btrim(p_settings->>'message_template'), ''), s.message_template)
  where s.shop_id = p_shop_id;

  perform public._write_audit(p_shop_id, 'shop.settings', 'shop', p_shop_id::text);
end
$$;

-- ---------------------------------------------------------------------
-- Daily running numbers: PN261113-001, KK261113-002, ...
-- ---------------------------------------------------------------------

create table public.shop_counters (
  shop_id uuid not null references public.shops (id) on delete cascade,
  kind text not null,
  day date not null,
  n integer not null default 0,
  primary key (shop_id, kind, day)
);

alter table public.shop_counters enable row level security;

-- Next running number of the day (Vietnam time) for a kind of document.
create or replace function public._next_code(p_shop_id uuid, p_kind text, p_prefix text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_n integer;
begin
  insert into public.shop_counters as c (shop_id, kind, day, n)
  values (p_shop_id, p_kind, v_day, 1)
  on conflict (shop_id, kind, day) do update set n = c.n + 1
  returning c.n into v_n;

  return p_prefix || to_char(v_day, 'YYMMDD') || '-' || lpad(v_n::text, 3, '0');
end
$$;

-- ---------------------------------------------------------------------
-- Products & variants
-- ---------------------------------------------------------------------

create table public.products (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 200),
  name_search text generated always as (public.vn_search_key(name)) stored,
  category text check (category is null or length(category) <= 100),
  unit text not null default 'cái' check (length(unit) between 1 and 20),
  description text check (description is null or length(description) <= 2000),
  image_path text,
  option_names text[] not null default '{}' check (cardinality(option_names) <= 3),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index products_shop_idx on public.products (shop_id, active, name_search);
create index products_name_trgm on public.products using gin (name_search extensions.gin_trgm_ops);

create trigger products_updated_at before update on public.products
  for each row execute function public.tg_set_updated_at();

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  sku text not null check (length(btrim(sku)) between 1 and 50),
  option_values text[] not null default '{}',
  variant_label text not null default '',
  price bigint not null default 0 check (price >= 0),
  cost bigint not null default 0 check (cost >= 0),
  weight_g integer not null default 0 check (weight_g >= 0),
  length_cm numeric(7, 1) check (length_cm is null or length_cm > 0),
  width_cm numeric(7, 1) check (width_cm is null or width_cm > 0),
  height_cm numeric(7, 1) check (height_cm is null or height_cm > 0),
  barcode text check (barcode is null or length(barcode) <= 50),
  image_path text,
  stock_qty integer not null default 0,
  low_stock_threshold integer not null default 0 check (low_stock_threshold >= 0),
  is_default boolean not null default false,
  active boolean not null default true,
  search_key text generated always as (
    public.vn_search_key(sku || ' ' || variant_label || ' ' || coalesce(barcode, ''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, sku)
);

create index product_variants_product_idx on public.product_variants (product_id);
create index product_variants_shop_idx on public.product_variants (shop_id, active);
create index product_variants_search_trgm
  on public.product_variants using gin (search_key extensions.gin_trgm_ops);

create trigger product_variants_updated_at before update on public.product_variants
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------
-- Stock ledger, receipts, stocktakes
-- ---------------------------------------------------------------------

create table public.stock_movements (
  id bigint generated always as identity primary key,
  shop_id uuid not null references public.shops (id) on delete cascade,
  variant_id uuid not null references public.product_variants (id),
  qty_change integer not null check (qty_change <> 0),
  type text not null check (type in ('receipt', 'order_out', 'order_cancel', 'return', 'adjust')),
  unit_cost bigint,
  ref_type text,
  ref_id uuid,
  stock_after integer not null,
  note text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index stock_movements_variant_idx on public.stock_movements (variant_id, id desc);
create index stock_movements_shop_idx on public.stock_movements (shop_id, created_at desc);

create table public.stock_receipts (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  code text not null,
  supplier text check (supplier is null or length(supplier) <= 200),
  note text check (note is null or length(note) <= 1000),
  total_cost bigint not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (shop_id, code)
);

create table public.stock_receipt_items (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  receipt_id uuid not null references public.stock_receipts (id) on delete cascade,
  variant_id uuid not null references public.product_variants (id),
  qty integer not null check (qty > 0),
  unit_cost bigint not null default 0 check (unit_cost >= 0)
);

create index stock_receipt_items_receipt_idx on public.stock_receipt_items (receipt_id);

create table public.stocktakes (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  code text not null,
  note text check (note is null or length(note) <= 1000),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (shop_id, code)
);

create table public.stocktake_items (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  stocktake_id uuid not null references public.stocktakes (id) on delete cascade,
  variant_id uuid not null references public.product_variants (id),
  system_qty integer not null,
  counted_qty integer not null check (counted_qty >= 0),
  diff integer not null
);

create index stocktake_items_stocktake_idx on public.stocktake_items (stocktake_id);

-- ---------------------------------------------------------------------
-- RLS: owners/admin read their shop; shippers read nothing here
-- ---------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'products', 'product_variants', 'stock_movements', 'stock_receipts',
    'stock_receipt_items', 'stocktakes', 'stocktake_items'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.can_manage_shop(shop_id))',
      t || '_select', t
    );
  end loop;
end
$$;

-- ---------------------------------------------------------------------
-- Internal: change stock of one variant and write the ledger row
-- ---------------------------------------------------------------------

create or replace function public._apply_stock_change(
  p_shop_id uuid,
  p_variant_id uuid,
  p_qty integer,
  p_type text,
  p_unit_cost bigint default null,
  p_ref_type text default null,
  p_ref_id uuid default null,
  p_note text default null,
  p_allow_negative boolean default true
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_stock integer;
  v_after integer;
  v_name text;
begin
  select v.stock_qty,
         p.name || case when v.variant_label = '' then '' else ' (' || v.variant_label || ')' end
  into v_stock, v_name
  from public.product_variants v
  join public.products p on p.id = v.product_id
  where v.id = p_variant_id and v.shop_id = p_shop_id
  for update of v;

  if not found then
    raise exception 'Không tìm thấy biến thể sản phẩm' using errcode = 'P0002';
  end if;

  v_after := v_stock + p_qty;
  if v_after < 0 and not p_allow_negative then
    raise exception 'Không đủ tồn kho: % chỉ còn %', v_name, v_stock using errcode = '23514';
  end if;

  update public.product_variants set stock_qty = v_after where id = p_variant_id;

  insert into public.stock_movements
    (shop_id, variant_id, qty_change, type, unit_cost, ref_type, ref_id, stock_after, note, created_by)
  values
    (p_shop_id, p_variant_id, p_qty, p_type, p_unit_cost, p_ref_type, p_ref_id, v_after, p_note,
     (select auth.uid()));

  return v_after;
end
$$;

-- ---------------------------------------------------------------------
-- RPC: save a product with all its variants in one call
--
-- p_product = {
--   id?, name, category, unit, description, image_path, active,
--   option_names: ["Màu","Size"],
--   variants: [{ id?, sku, option_values:["Đỏ","M"], price, cost, weight_g,
--                length_cm, width_cm, height_cm, barcode, image_path,
--                low_stock_threshold, active }]
-- }
-- Variants missing from the payload are deactivated, never deleted.
-- ---------------------------------------------------------------------

create or replace function public.save_product(p_shop_id uuid, p_product jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := nullif(p_product->>'id', '')::uuid;
  v_name text := btrim(coalesce(p_product->>'name', ''));
  v_options text[];
  v_variants jsonb := coalesce(p_product->'variants', '[]'::jsonb);
  v jsonb;
  v_vid uuid;
  v_values text[];
  v_label text;
  v_sku text;
  v_keep uuid[] := '{}';
  v_labels text[] := '{}';
begin
  if not public.can_manage_shop(p_shop_id) then
    raise exception 'Bạn không có quyền quản lý cửa hàng này' using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception 'Nhập tên sản phẩm' using errcode = '22023';
  end if;

  v_options := array(
    select btrim(x) from jsonb_array_elements_text(coalesce(p_product->'option_names', '[]'::jsonb)) x
  );
  if cardinality(v_options) > 3 then
    raise exception 'Tối đa 3 thuộc tính (ví dụ Màu, Size)' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_options) o where o = '') then
    raise exception 'Tên thuộc tính không được để trống' using errcode = '22023';
  end if;
  if jsonb_typeof(v_variants) <> 'array' or jsonb_array_length(v_variants) = 0 then
    raise exception 'Sản phẩm cần ít nhất một biến thể' using errcode = '22023';
  end if;
  if cardinality(v_options) = 0 and jsonb_array_length(v_variants) <> 1 then
    raise exception 'Sản phẩm không có thuộc tính chỉ có một biến thể' using errcode = '22023';
  end if;

  begin
    if v_id is null then
      insert into public.products (shop_id, name, category, unit, description, image_path, option_names, active)
      values (
        p_shop_id, v_name,
        nullif(btrim(p_product->>'category'), ''),
        coalesce(nullif(btrim(p_product->>'unit'), ''), 'cái'),
        nullif(btrim(p_product->>'description'), ''),
        nullif(p_product->>'image_path', ''),
        v_options,
        coalesce((p_product->>'active')::boolean, true)
      )
      returning id into v_id;
    else
      update public.products
      set name = v_name,
          category = nullif(btrim(p_product->>'category'), ''),
          unit = coalesce(nullif(btrim(p_product->>'unit'), ''), 'cái'),
          description = nullif(btrim(p_product->>'description'), ''),
          image_path = nullif(p_product->>'image_path', ''),
          option_names = v_options,
          active = coalesce((p_product->>'active')::boolean, true)
      where id = v_id and shop_id = p_shop_id;
      if not found then
        raise exception 'Không tìm thấy sản phẩm' using errcode = 'P0002';
      end if;
    end if;

    for v in select * from jsonb_array_elements(v_variants)
    loop
      v_values := array(
        select btrim(x) from jsonb_array_elements_text(coalesce(v->'option_values', '[]'::jsonb)) x
      );
      if cardinality(v_values) <> cardinality(v_options) or exists (select 1 from unnest(v_values) o where o = '') then
        raise exception 'Mỗi biến thể phải có đủ giá trị cho các thuộc tính' using errcode = '22023';
      end if;
      v_label := array_to_string(v_values, ' / ');
      if v_label = any (v_labels) and cardinality(v_options) > 0 then
        raise exception 'Biến thể "%" bị trùng', v_label using errcode = '22023';
      end if;
      v_labels := v_labels || v_label;

      v_sku := btrim(coalesce(v->>'sku', ''));
      if v_sku = '' then
        raise exception 'Mỗi biến thể cần mã SKU' using errcode = '22023';
      end if;

      v_vid := nullif(v->>'id', '')::uuid;
      if v_vid is null then
        insert into public.product_variants (
          shop_id, product_id, sku, option_values, variant_label, price, cost, weight_g,
          length_cm, width_cm, height_cm, barcode, image_path, low_stock_threshold,
          is_default, active
        ) values (
          p_shop_id, v_id, v_sku, v_values, v_label,
          coalesce((v->>'price')::bigint, 0), coalesce((v->>'cost')::bigint, 0),
          coalesce((v->>'weight_g')::integer, 0),
          (v->>'length_cm')::numeric, (v->>'width_cm')::numeric, (v->>'height_cm')::numeric,
          nullif(btrim(v->>'barcode'), ''), nullif(v->>'image_path', ''),
          coalesce((v->>'low_stock_threshold')::integer, 0),
          cardinality(v_options) = 0,
          coalesce((v->>'active')::boolean, true)
        )
        returning id into v_vid;
      else
        update public.product_variants
        set sku = v_sku,
            option_values = v_values,
            variant_label = v_label,
            price = coalesce((v->>'price')::bigint, 0),
            cost = coalesce((v->>'cost')::bigint, 0),
            weight_g = coalesce((v->>'weight_g')::integer, 0),
            length_cm = (v->>'length_cm')::numeric,
            width_cm = (v->>'width_cm')::numeric,
            height_cm = (v->>'height_cm')::numeric,
            barcode = nullif(btrim(v->>'barcode'), ''),
            image_path = nullif(v->>'image_path', ''),
            low_stock_threshold = coalesce((v->>'low_stock_threshold')::integer, 0),
            is_default = cardinality(v_options) = 0,
            active = coalesce((v->>'active')::boolean, true)
        where id = v_vid and product_id = v_id and shop_id = p_shop_id;
        if not found then
          raise exception 'Không tìm thấy biến thể để cập nhật' using errcode = 'P0002';
        end if;
      end if;
      v_keep := v_keep || v_vid;
    end loop;
  exception when unique_violation then
    raise exception 'Mã SKU "%" đã được dùng trong cửa hàng', v_sku using errcode = '23505';
  end;

  update public.product_variants
  set active = false
  where product_id = v_id and active and not (id = any (v_keep));

  perform public._write_audit(p_shop_id, 'product.save', 'product', v_id::text,
                              jsonb_build_object('name', v_name));
  return v_id;
end
$$;

-- ---------------------------------------------------------------------
-- RPC: list products (with variants) — search, filters, paging
--   p_filter: active (default) | inactive | low | all
-- ---------------------------------------------------------------------

create or replace function public.list_products(
  p_shop_id uuid,
  p_query text default null,
  p_filter text default 'active',
  p_limit integer default 30,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := nullif(public.vn_search_key(btrim(coalesce(p_query, ''))), '');
  v_result jsonb;
begin
  if not public.can_manage_shop(p_shop_id) then
    raise exception 'Bạn không có quyền quản lý cửa hàng này' using errcode = '42501';
  end if;

  with matched as (
    select p.*
    from public.products p
    where p.shop_id = p_shop_id
      and case p_filter
            when 'inactive' then not p.active
            when 'all' then true
            else p.active
          end
      and (
        v_q is null
        or p.name_search like '%' || v_q || '%'
        or exists (
          select 1 from public.product_variants v
          where v.product_id = p.id and v.search_key like '%' || v_q || '%'
        )
      )
      and (
        p_filter <> 'low'
        or exists (
          select 1 from public.product_variants v
          where v.product_id = p.id and v.active
            and v.low_stock_threshold > 0 and v.stock_qty <= v.low_stock_threshold
        )
      )
    order by p.name_search, p.id
    limit greatest(least(p_limit, 100), 1) offset greatest(p_offset, 0)
  )
  select coalesce(jsonb_agg(
    (to_jsonb(m) - 'name_search') || jsonb_build_object(
      'variants', (
        select coalesce(jsonb_agg(to_jsonb(v) - 'search_key' order by v.is_default desc, v.variant_label, v.sku), '[]'::jsonb)
        from public.product_variants v
        where v.product_id = m.id
      )
    )
    order by m.name_search, m.id
  ), '[]'::jsonb)
  into v_result
  from matched m;

  return v_result;
end
$$;

-- ---------------------------------------------------------------------
-- RPC: stock receipt (nhập kho)
--   p_payload = { supplier, note, items: [{ variant_id, qty, unit_cost }] }
--   Cost uses a moving average: (stock*cost + qty*unit_cost) / (stock + qty).
-- ---------------------------------------------------------------------

create or replace function public.receive_stock(p_shop_id uuid, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_code text;
  v_total bigint := 0;
  r record;
  v_stock integer;
  v_cost bigint;
  v_new_cost bigint;
begin
  if not public.can_manage_shop(p_shop_id) then
    raise exception 'Bạn không có quyền quản lý cửa hàng này' using errcode = '42501';
  end if;
  if jsonb_typeof(p_payload->'items') is distinct from 'array'
     or jsonb_array_length(p_payload->'items') = 0 then
    raise exception 'Phiếu nhập cần ít nhất một dòng' using errcode = '22023';
  end if;

  v_code := public._next_code(p_shop_id, 'receipt', 'PN');
  insert into public.stock_receipts (shop_id, code, supplier, note, created_by)
  values (p_shop_id, v_code, nullif(btrim(p_payload->>'supplier'), ''),
          nullif(btrim(p_payload->>'note'), ''), (select auth.uid()))
  returning id into v_id;

  -- Merge duplicate variants; lock in id order to avoid deadlocks.
  for r in
    select x.variant_id,
           sum(x.qty)::integer as qty,
           round(sum(x.qty::numeric * coalesce(x.unit_cost, 0)) / nullif(sum(x.qty), 0))::bigint as unit_cost
    from jsonb_to_recordset(p_payload->'items') as x(variant_id uuid, qty integer, unit_cost bigint)
    group by x.variant_id
    order by x.variant_id
  loop
    if r.qty is null or r.qty <= 0 then
      raise exception 'Số lượng nhập phải lớn hơn 0' using errcode = '22023';
    end if;

    select stock_qty, cost into v_stock, v_cost
    from public.product_variants
    where id = r.variant_id and shop_id = p_shop_id
    for update;
    if not found then
      raise exception 'Không tìm thấy biến thể sản phẩm' using errcode = 'P0002';
    end if;

    if coalesce(r.unit_cost, 0) > 0 then
      v_new_cost := case
        when v_stock > 0 then round((v_stock::numeric * v_cost + r.qty::numeric * r.unit_cost) / (v_stock + r.qty))
        else r.unit_cost
      end;
      update public.product_variants set cost = v_new_cost where id = r.variant_id;
    end if;

    insert into public.stock_receipt_items (shop_id, receipt_id, variant_id, qty, unit_cost)
    values (p_shop_id, v_id, r.variant_id, r.qty, coalesce(r.unit_cost, 0));

    perform public._apply_stock_change(
      p_shop_id, r.variant_id, r.qty, 'receipt', r.unit_cost, 'stock_receipt', v_id, v_code, true
    );
    v_total := v_total + r.qty * coalesce(r.unit_cost, 0);
  end loop;

  update public.stock_receipts set total_cost = v_total where id = v_id;
  perform public._write_audit(p_shop_id, 'stock.receive', 'stock_receipt', v_id::text,
                              jsonb_build_object('code', v_code, 'total_cost', v_total));
  return v_id;
end
$$;

-- ---------------------------------------------------------------------
-- RPC: stocktake (kiểm kho)
--   p_payload = { note, items: [{ variant_id, counted_qty }] }
--   Differences are written to the ledger as "adjust" movements.
-- ---------------------------------------------------------------------

create or replace function public.apply_stocktake(p_shop_id uuid, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_code text;
  r record;
  v_system integer;
  v_diffs integer := 0;
begin
  if not public.can_manage_shop(p_shop_id) then
    raise exception 'Bạn không có quyền quản lý cửa hàng này' using errcode = '42501';
  end if;
  if jsonb_typeof(p_payload->'items') is distinct from 'array'
     or jsonb_array_length(p_payload->'items') = 0 then
    raise exception 'Phiếu kiểm kho cần ít nhất một dòng' using errcode = '22023';
  end if;

  v_code := public._next_code(p_shop_id, 'stocktake', 'KK');
  insert into public.stocktakes (shop_id, code, note, created_by)
  values (p_shop_id, v_code, nullif(btrim(p_payload->>'note'), ''), (select auth.uid()))
  returning id into v_id;

  for r in
    select x.variant_id, max(x.counted_qty) as counted_qty
    from jsonb_to_recordset(p_payload->'items') as x(variant_id uuid, counted_qty integer)
    group by x.variant_id
    order by x.variant_id
  loop
    if r.counted_qty is null or r.counted_qty < 0 then
      raise exception 'Số đếm thực tế không hợp lệ' using errcode = '22023';
    end if;

    select stock_qty into v_system
    from public.product_variants
    where id = r.variant_id and shop_id = p_shop_id
    for update;
    if not found then
      raise exception 'Không tìm thấy biến thể sản phẩm' using errcode = 'P0002';
    end if;

    insert into public.stocktake_items (shop_id, stocktake_id, variant_id, system_qty, counted_qty, diff)
    values (p_shop_id, v_id, r.variant_id, v_system, r.counted_qty, r.counted_qty - v_system);

    if r.counted_qty <> v_system then
      v_diffs := v_diffs + 1;
      perform public._apply_stock_change(
        p_shop_id, r.variant_id, r.counted_qty - v_system, 'adjust', null,
        'stocktake', v_id, v_code, true
      );
    end if;
  end loop;

  perform public._write_audit(p_shop_id, 'stock.stocktake', 'stocktake', v_id::text,
                              jsonb_build_object('code', v_code, 'differences', v_diffs));
  return v_id;
end
$$;

-- ---------------------------------------------------------------------
-- RPC: admin · system settings and audit log
-- ---------------------------------------------------------------------

create or replace function public.admin_save_system_settings(p_settings jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Chỉ admin được đổi cài đặt hệ thống' using errcode = '42501';
  end if;

  update public.system_settings
  set map_provider = coalesce(p_settings->>'map_provider', map_provider),
      updated_by = (select auth.uid())
  where id = 1;

  perform public._write_audit(null, 'system.settings', 'system', '1', p_settings);
end
$$;

create or replace function public.admin_list_audit(
  p_limit integer default 50,
  p_before bigint default null
)
returns table (
  id bigint,
  created_at timestamptz,
  action text,
  target_type text,
  target_id text,
  data jsonb,
  actor_name text,
  shop_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Chỉ admin được xem nhật ký' using errcode = '42501';
  end if;

  return query
  select a.id, a.created_at, a.action, a.target_type, a.target_id, a.data,
         p.full_name, s.name
  from public.audit_logs a
  left join public.profiles p on p.id = a.actor_id
  left join public.shops s on s.id = a.shop_id
  where p_before is null or a.id < p_before
  order by a.id desc
  limit greatest(least(p_limit, 200), 1);
end
$$;

select public._apply_grants();
