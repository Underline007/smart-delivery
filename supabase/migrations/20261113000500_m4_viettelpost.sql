-- =====================================================================
-- M4 · ViettelPost bulk Excel export
--
--   * The Excel file is built in the browser from the admin's uploaded
--     template + column mapping (system_settings).
--   * Exporting creates a batch; its orders move to "vtp_exported".
--     Cancelling the batch puts them back to "confirmed".
--   * Tracking codes typed in or imported from ViettelPost's order list
--     are matched on the shop's own order code.
-- =====================================================================

alter table public.system_settings
  add column vtp_template_name text,
  add column vtp_template_b64 text check (vtp_template_b64 is null or length(vtp_template_b64) <= 3000000);

create table public.vtp_export_batches (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  file_name text not null,
  order_count integer not null check (order_count > 0),
  template_version text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz
);

create index vtp_export_batches_shop_idx on public.vtp_export_batches (shop_id, created_at desc);

alter table public.vtp_export_batches enable row level security;
create policy vtp_export_batches_select on public.vtp_export_batches
  for select to authenticated using (public.can_manage_shop(shop_id));

alter table public.orders
  add constraint orders_vtp_batch_fk foreign key (vtp_batch_id)
  references public.vtp_export_batches (id) on delete set null;

-- ---------------------------------------------------------------------
-- Admin: save the template file and the column mapping
--   p_mapping = { sheet, headerRow, firstDataRow, columns: [{ col, field, header?, value? }], values: {...} }
-- ---------------------------------------------------------------------

create or replace function public.admin_save_vtp_template(
  p_name text,
  p_b64 text,
  p_mapping jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version text := to_char(now() at time zone 'utc', 'YYYYMMDDHH24MISS');
begin
  if not public.is_admin() then
    raise exception 'Chỉ admin được đổi mẫu Excel' using errcode = '42501';
  end if;
  if p_b64 is not null and length(p_b64) > 3000000 then
    raise exception 'File mẫu quá lớn (tối đa khoảng 2 MB)' using errcode = '22023';
  end if;
  if p_mapping is not null and jsonb_typeof(p_mapping->'columns') is distinct from 'array' then
    raise exception 'Cấu hình cột không hợp lệ' using errcode = '22023';
  end if;

  update public.system_settings
  set vtp_template_name = nullif(btrim(p_name), ''),
      vtp_template_b64 = p_b64,
      vtp_column_mapping = p_mapping,
      vtp_template_version = case when p_mapping is null and p_b64 is null then null else v_version end,
      updated_by = (select auth.uid())
  where id = 1;

  perform public._write_audit(null, 'system.vtp_template', 'system', '1',
                              jsonb_build_object('name', p_name, 'has_file', p_b64 is not null));
  return v_version;
end
$$;

-- ---------------------------------------------------------------------
-- Export batches
-- ---------------------------------------------------------------------

create or replace function public.create_vtp_batch(
  p_shop_id uuid,
  p_order_ids uuid[],
  p_file_name text,
  p_template_version text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch uuid;
  r record;
begin
  if not public.can_manage_shop(p_shop_id) then
    raise exception 'Bạn không có quyền quản lý cửa hàng này' using errcode = '42501';
  end if;
  if p_order_ids is null or cardinality(p_order_ids) = 0 then
    raise exception 'Chọn ít nhất một đơn để xuất' using errcode = '22023';
  end if;

  for r in
    select o.id, o.code, o.status, o.delivery_method, b.file_name as batch_file
    from public.orders o
    left join public.vtp_export_batches b on b.id = o.vtp_batch_id and b.cancelled_at is null
    where o.shop_id = p_shop_id and o.id = any (p_order_ids)
    order by o.code
    for update of o
  loop
    if r.status = 'vtp_exported' then
      raise exception 'Đơn % đã được xuất ở lô "%". Huỷ lô đó trước nếu muốn xuất lại.', r.code, coalesce(r.batch_file, '?')
        using errcode = '55000';
    end if;
    if r.status <> 'confirmed' or r.delivery_method <> 'vtp' then
      raise exception 'Đơn % không ở trạng thái "Đã xác nhận" giao bằng ViettelPost', r.code using errcode = '55000';
    end if;
  end loop;

  if (select count(*) from public.orders where shop_id = p_shop_id and id = any (p_order_ids)) <> cardinality(p_order_ids) then
    raise exception 'Có đơn không thuộc cửa hàng này' using errcode = 'P0002';
  end if;

  insert into public.vtp_export_batches (shop_id, file_name, order_count, template_version, created_by)
  values (p_shop_id, left(btrim(p_file_name), 200), cardinality(p_order_ids), p_template_version, (select auth.uid()))
  returning id into v_batch;

  update public.orders set vtp_batch_id = v_batch where shop_id = p_shop_id and id = any (p_order_ids);

  for r in select id from public.orders where id = any (p_order_ids) order by code loop
    perform public._apply_order_status(p_shop_id, r.id, 'vtp_exported', 'Xuất file ' || left(btrim(p_file_name), 100));
  end loop;

  return v_batch;
end
$$;

create or replace function public.cancel_vtp_batch(p_shop_id uuid, p_batch_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_count integer := 0;
begin
  if not public.can_manage_shop(p_shop_id) then
    raise exception 'Bạn không có quyền quản lý cửa hàng này' using errcode = '42501';
  end if;
  if not exists (select 1 from public.vtp_export_batches where id = p_batch_id and shop_id = p_shop_id) then
    raise exception 'Không tìm thấy lô xuất' using errcode = 'P0002';
  end if;

  -- Orders that already moved on (have a tracking code) stay as they are.
  for r in
    select id from public.orders
    where vtp_batch_id = p_batch_id and shop_id = p_shop_id and status = 'vtp_exported'
    order by code
  loop
    perform public._apply_order_status(p_shop_id, r.id, 'confirmed', 'Huỷ lô xuất');
    update public.orders set vtp_batch_id = null where id = r.id;
    v_count := v_count + 1;
  end loop;

  update public.vtp_export_batches set cancelled_at = now() where id = p_batch_id and cancelled_at is null;
  return v_count;
end
$$;

-- ---------------------------------------------------------------------
-- Tracking codes
--   p_rows = [{ order_code, tracking_code }]
--   Returns { applied: n, skipped: [{ code, reason }] }
-- ---------------------------------------------------------------------

create or replace function public.apply_vtp_tracking(p_shop_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  x record;
  o public.orders;
  v_applied integer := 0;
  v_skipped jsonb := '[]'::jsonb;
begin
  if not public.can_manage_shop(p_shop_id) then
    raise exception 'Bạn không có quyền quản lý cửa hàng này' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Dữ liệu mã vận đơn không hợp lệ' using errcode = '22023';
  end if;

  for x in
    select upper(btrim(t.order_code)) as code, btrim(t.tracking_code) as tracking
    from jsonb_to_recordset(p_rows) as t(order_code text, tracking_code text)
  loop
    if coalesce(x.code, '') = '' or coalesce(x.tracking, '') = '' then
      v_skipped := v_skipped || jsonb_build_object('code', x.code, 'reason', 'Thiếu mã đơn hoặc mã vận đơn');
      continue;
    end if;
    if length(x.tracking) > 50 then
      v_skipped := v_skipped || jsonb_build_object('code', x.code, 'reason', 'Mã vận đơn quá dài');
      continue;
    end if;

    select * into o from public.orders where shop_id = p_shop_id and upper(code) = x.code for update;
    if not found then
      v_skipped := v_skipped || jsonb_build_object('code', x.code, 'reason', 'Không tìm thấy đơn');
      continue;
    end if;
    if o.delivery_method <> 'vtp' then
      v_skipped := v_skipped || jsonb_build_object('code', x.code, 'reason', 'Đơn không giao bằng ViettelPost');
      continue;
    end if;
    if o.status not in ('confirmed', 'vtp_exported', 'shipping') then
      v_skipped := v_skipped || jsonb_build_object('code', x.code, 'reason', 'Đơn đang ở trạng thái "' || o.status || '"');
      continue;
    end if;

    update public.orders set vtp_tracking_code = x.tracking where id = o.id;
    if o.status in ('confirmed', 'vtp_exported') then
      perform public._apply_order_status(p_shop_id, o.id, 'shipping', 'Mã vận đơn ' || x.tracking);
    end if;
    v_applied := v_applied + 1;
  end loop;

  return jsonb_build_object('applied', v_applied, 'skipped', v_skipped);
end
$$;

select public._apply_grants();
