-- =====================================================================
-- M2 · Administrative catalogue (34 provinces after the 07/2025 merger),
--      customers and their addresses
--
--   * Provinces are seeded. Wards (~3.300) are imported by the admin from
--     a CSV, ideally the catalogue used by the ViettelPost template.
--   * Old province names (e.g. "Bình Dương") are aliases of the province
--     that absorbed them, so customers' old addresses still match.
--   * Addresses keep ward_text as a fallback while the ward catalogue is
--     empty or a ward is missing from it.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------

create table public.provinces (
  code text primary key,
  name text not null,
  name_search text generated always as (public.vn_search_key(name)) stored
);

create table public.wards (
  code text primary key,
  province_code text not null references public.provinces (code) on delete cascade,
  name text not null,
  name_search text generated always as (public.vn_search_key(name)) stored,
  -- Name without "Phường / Xã / Thị trấn / Đặc khu" in front.
  short_search text generated always as (
    regexp_replace(public.vn_search_key(name), '^(phuong|xa|thi tran|dac khu)\s+', '')
  ) stored
);

create index wards_province_idx on public.wards (province_code, name_search);

create table public.province_aliases (
  alias_search text primary key,
  province_code text not null references public.provinces (code) on delete cascade
);

create table public.ward_aliases (
  alias_search text not null,
  ward_code text not null references public.wards (code) on delete cascade,
  primary key (alias_search, ward_code)
);

insert into public.provinces (code, name) values
  ('01', 'Hà Nội'), ('04', 'Cao Bằng'), ('08', 'Tuyên Quang'), ('11', 'Điện Biên'),
  ('12', 'Lai Châu'), ('14', 'Sơn La'), ('15', 'Lào Cai'), ('19', 'Thái Nguyên'),
  ('20', 'Lạng Sơn'), ('22', 'Quảng Ninh'), ('24', 'Bắc Ninh'), ('25', 'Phú Thọ'),
  ('31', 'Hải Phòng'), ('33', 'Hưng Yên'), ('37', 'Ninh Bình'), ('38', 'Thanh Hóa'),
  ('40', 'Nghệ An'), ('42', 'Hà Tĩnh'), ('44', 'Quảng Trị'), ('46', 'Huế'),
  ('48', 'Đà Nẵng'), ('51', 'Quảng Ngãi'), ('52', 'Gia Lai'), ('56', 'Khánh Hòa'),
  ('66', 'Đắk Lắk'), ('68', 'Lâm Đồng'), ('75', 'Đồng Nai'), ('79', 'TP. Hồ Chí Minh'),
  ('80', 'Tây Ninh'), ('82', 'Đồng Tháp'), ('86', 'Vĩnh Long'), ('91', 'An Giang'),
  ('92', 'Cần Thơ'), ('96', 'Cà Mau');

-- Old (pre-merger) provinces and common abbreviations → current province.
insert into public.province_aliases (alias_search, province_code) values
  ('hn', '01'), ('ha noi', '01'),
  ('ha giang', '08'),
  ('yen bai', '15'),
  ('bac kan', '19'),
  ('vinh phuc', '25'), ('hoa binh', '25'),
  ('bac giang', '24'),
  ('thai binh', '33'),
  ('hai duong', '31'),
  ('ha nam', '37'), ('nam dinh', '37'),
  ('quang binh', '44'),
  ('thua thien hue', '46'), ('hue', '46'),
  ('quang nam', '48'),
  ('kon tum', '51'),
  ('binh dinh', '52'), ('quy nhon', '52'),
  ('ninh thuan', '56'),
  ('phu yen', '66'), ('dak lak', '66'), ('dac lac', '66'),
  ('dak nong', '68'), ('dac nong', '68'), ('binh thuan', '68'), ('da lat', '68'),
  ('hcm', '79'), ('tphcm', '79'), ('tp hcm', '79'), ('sai gon', '79'), ('sg', '79'),
  ('ho chi minh', '79'), ('tp ho chi minh', '79'),
  ('binh duong', '79'), ('ba ria vung tau', '79'), ('ba ria', '79'), ('vung tau', '79'),
  ('binh phuoc', '75'),
  ('long an', '80'),
  ('soc trang', '92'), ('hau giang', '92'),
  ('ben tre', '86'), ('tra vinh', '86'),
  ('tien giang', '82'),
  ('bac lieu', '96'),
  ('kien giang', '91'), ('phu quoc', '91');

alter table public.provinces enable row level security;
alter table public.wards enable row level security;
alter table public.province_aliases enable row level security;
alter table public.ward_aliases enable row level security;

create policy provinces_select on public.provinces for select to authenticated using (true);
create policy wards_select on public.wards for select to authenticated using (true);
create policy province_aliases_select on public.province_aliases for select to authenticated using (true);
create policy ward_aliases_select on public.ward_aliases for select to authenticated using (true);

-- Admin: upsert catalogue rows (called in batches by the import screen).
create or replace function public.admin_upsert_provinces(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not public.is_admin() then
    raise exception 'Chỉ admin được sửa danh mục' using errcode = '42501';
  end if;

  insert into public.provinces (code, name)
  select btrim(x.code), btrim(x.name)
  from jsonb_to_recordset(p_rows) as x(code text, name text)
  where btrim(coalesce(x.code, '')) <> '' and btrim(coalesce(x.name, '')) <> ''
  on conflict (code) do update set name = excluded.name;

  get diagnostics v_count = row_count;
  perform public._write_audit(null, 'catalog.provinces', 'catalog', null, jsonb_build_object('rows', v_count));
  return v_count;
end
$$;

create or replace function public.admin_upsert_wards(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_missing text;
begin
  if not public.is_admin() then
    raise exception 'Chỉ admin được sửa danh mục' using errcode = '42501';
  end if;

  select x.province_code into v_missing
  from jsonb_to_recordset(p_rows) as x(code text, province_code text, name text)
  where not exists (select 1 from public.provinces p where p.code = x.province_code)
  limit 1;
  if v_missing is not null then
    raise exception 'Không tìm thấy tỉnh có mã "%"', v_missing using errcode = '22023';
  end if;

  insert into public.wards (code, province_code, name)
  select btrim(x.code), x.province_code, btrim(x.name)
  from jsonb_to_recordset(p_rows) as x(code text, province_code text, name text)
  where btrim(coalesce(x.code, '')) <> '' and btrim(coalesce(x.name, '')) <> ''
  on conflict (code) do update
    set province_code = excluded.province_code, name = excluded.name;

  get diagnostics v_count = row_count;
  perform public._write_audit(null, 'catalog.wards', 'catalog', null, jsonb_build_object('rows', v_count));
  return v_count;
end
$$;

-- Aliases: each row has an alias and either province_code or ward_code.
create or replace function public.admin_upsert_aliases(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_n integer;
begin
  if not public.is_admin() then
    raise exception 'Chỉ admin được sửa danh mục' using errcode = '42501';
  end if;

  insert into public.province_aliases (alias_search, province_code)
  select public.vn_search_key(btrim(x.alias)), x.province_code
  from jsonb_to_recordset(p_rows) as x(alias text, province_code text, ward_code text)
  where x.province_code is not null and btrim(coalesce(x.alias, '')) <> ''
    and exists (select 1 from public.provinces p where p.code = x.province_code)
  on conflict (alias_search) do update set province_code = excluded.province_code;
  get diagnostics v_n = row_count;
  v_count := v_count + v_n;

  insert into public.ward_aliases (alias_search, ward_code)
  select public.vn_search_key(btrim(x.alias)), x.ward_code
  from jsonb_to_recordset(p_rows) as x(alias text, province_code text, ward_code text)
  where x.ward_code is not null and btrim(coalesce(x.alias, '')) <> ''
    and exists (select 1 from public.wards w where w.code = x.ward_code)
  on conflict do nothing;
  get diagnostics v_n = row_count;
  v_count := v_count + v_n;

  return v_count;
end
$$;

-- ---------------------------------------------------------------------
-- Customers & addresses
-- ---------------------------------------------------------------------

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 100),
  name_search text generated always as (public.vn_search_key(name)) stored,
  phone text not null check (phone ~ '^0[35789][0-9]{8}$'),
  phone2 text check (phone2 is null or phone2 ~ '^0[35789][0-9]{8}$'),
  tags text[] not null default '{}' check (cardinality(tags) <= 10),
  note text check (note is null or length(note) <= 1000),
  order_count integer not null default 0,
  delivered_count integer not null default 0,
  returned_count integer not null default 0,
  total_spent bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, phone)
);

create index customers_shop_name_idx on public.customers (shop_id, name_search);
create index customers_name_trgm on public.customers using gin (name_search extensions.gin_trgm_ops);
create index customers_phone_trgm on public.customers using gin (phone extensions.gin_trgm_ops);

create trigger customers_updated_at before update on public.customers
  for each row execute function public.tg_set_updated_at();

create table public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  label text check (label is null or length(label) <= 50),
  detail text not null check (length(btrim(detail)) between 1 and 300),
  province_code text references public.provinces (code),
  ward_code text references public.wards (code),
  ward_text text check (ward_text is null or length(ward_text) <= 100),
  full_text text not null,
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  geo_source text check (geo_source in ('gps', 'link', 'manual', 'osm', 'google', 'ors')),
  place_id text,
  geocoded_at timestamptz,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((lat is null) = (lng is null))
);

create index customer_addresses_customer_idx on public.customer_addresses (customer_id);
create unique index customer_addresses_one_default
  on public.customer_addresses (customer_id) where is_default;

create trigger customer_addresses_updated_at before update on public.customer_addresses
  for each row execute function public.tg_set_updated_at();

alter table public.customers enable row level security;
alter table public.customer_addresses enable row level security;

create policy customers_select on public.customers
  for select to authenticated using (public.can_manage_shop(shop_id));
create policy customer_addresses_select on public.customer_addresses
  for select to authenticated using (public.can_manage_shop(shop_id));

-- "12 Lê Lợi, Phường Bến Thành, TP. Hồ Chí Minh"
create or replace function public._address_text(
  p_detail text,
  p_ward_code text,
  p_ward_text text,
  p_province_code text
)
returns text
language sql
stable
set search_path = ''
as $$
  select concat_ws(', ',
    nullif(btrim(p_detail), ''),
    coalesce((select w.name from public.wards w where w.code = p_ward_code), nullif(btrim(p_ward_text), '')),
    (select p.name from public.provinces p where p.code = p_province_code)
  )
$$;

-- ---------------------------------------------------------------------
-- RPC: save customer
--   p_customer = { id?, name, phone, phone2, tags: [], note }
-- ---------------------------------------------------------------------

create or replace function public.save_customer(p_shop_id uuid, p_customer jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := nullif(p_customer->>'id', '')::uuid;
  v_name text := btrim(coalesce(p_customer->>'name', ''));
  v_phone text := public.normalize_vn_mobile(p_customer->>'phone');
  v_phone2 text := public.normalize_vn_mobile(p_customer->>'phone2');
  v_tags text[];
  v_existing uuid;
  v_existing_name text;
begin
  if not public.can_manage_shop(p_shop_id) then
    raise exception 'Bạn không có quyền quản lý cửa hàng này' using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception 'Nhập tên khách hàng' using errcode = '22023';
  end if;
  if v_phone is null then
    raise exception 'Số điện thoại di động không hợp lệ' using errcode = '22023';
  end if;
  if btrim(coalesce(p_customer->>'phone2', '')) <> '' and v_phone2 is null then
    raise exception 'Số điện thoại phụ không hợp lệ' using errcode = '22023';
  end if;

  v_tags := array(
    select distinct btrim(t)
    from jsonb_array_elements_text(coalesce(p_customer->'tags', '[]'::jsonb)) t
    where btrim(t) <> ''
  );

  select c.id, c.name into v_existing, v_existing_name
  from public.customers c
  where c.shop_id = p_shop_id and c.phone = v_phone and c.id is distinct from v_id;
  if found then
    raise exception 'Số điện thoại % đã có trong danh sách khách (%)', v_phone, v_existing_name
      using errcode = '23505', hint = v_existing::text;
  end if;

  if v_id is null then
    insert into public.customers (shop_id, name, phone, phone2, tags, note)
    values (p_shop_id, v_name, v_phone, v_phone2, v_tags, nullif(btrim(p_customer->>'note'), ''))
    returning id into v_id;
  else
    update public.customers
    set name = v_name, phone = v_phone, phone2 = v_phone2, tags = v_tags,
        note = nullif(btrim(p_customer->>'note'), '')
    where id = v_id and shop_id = p_shop_id;
    if not found then
      raise exception 'Không tìm thấy khách hàng' using errcode = 'P0002';
    end if;
  end if;

  return v_id;
end
$$;

-- ---------------------------------------------------------------------
-- RPC: save / delete a customer address
--   p_address = { id?, label, detail, province_code, ward_code, ward_text,
--                 lat, lng, geo_source, place_id, is_default }
-- ---------------------------------------------------------------------

create or replace function public.save_customer_address(
  p_shop_id uuid,
  p_customer_id uuid,
  p_address jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := nullif(p_address->>'id', '')::uuid;
  v_detail text := btrim(coalesce(p_address->>'detail', ''));
  v_province text := nullif(p_address->>'province_code', '');
  v_ward text := nullif(p_address->>'ward_code', '');
  v_ward_text text := nullif(btrim(p_address->>'ward_text'), '');
  v_lat double precision := (p_address->>'lat')::double precision;
  v_lng double precision := (p_address->>'lng')::double precision;
  v_default boolean := coalesce((p_address->>'is_default')::boolean, false);
  v_text text;
begin
  if not public.can_manage_shop(p_shop_id) then
    raise exception 'Bạn không có quyền quản lý cửa hàng này' using errcode = '42501';
  end if;
  if not exists (select 1 from public.customers where id = p_customer_id and shop_id = p_shop_id) then
    raise exception 'Không tìm thấy khách hàng' using errcode = 'P0002';
  end if;
  if v_detail = '' then
    raise exception 'Nhập địa chỉ chi tiết (số nhà, đường)' using errcode = '22023';
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

  -- The first address of a customer is always the default one.
  if not exists (select 1 from public.customer_addresses where customer_id = p_customer_id and id is distinct from v_id) then
    v_default := true;
  end if;
  if v_default then
    update public.customer_addresses set is_default = false
    where customer_id = p_customer_id and is_default and id is distinct from v_id;
  end if;

  v_text := public._address_text(v_detail, v_ward, v_ward_text, v_province);

  if v_id is null then
    insert into public.customer_addresses (
      shop_id, customer_id, label, detail, province_code, ward_code, ward_text, full_text,
      lat, lng, geo_source, place_id, geocoded_at, is_default
    ) values (
      p_shop_id, p_customer_id, nullif(btrim(p_address->>'label'), ''), v_detail, v_province, v_ward,
      v_ward_text, v_text, v_lat, v_lng, nullif(p_address->>'geo_source', ''),
      nullif(p_address->>'place_id', ''), case when v_lat is null then null else now() end, v_default
    )
    returning id into v_id;
  else
    update public.customer_addresses
    set label = nullif(btrim(p_address->>'label'), ''),
        detail = v_detail, province_code = v_province, ward_code = v_ward, ward_text = v_ward_text,
        full_text = v_text, lat = v_lat, lng = v_lng,
        geo_source = nullif(p_address->>'geo_source', ''),
        place_id = nullif(p_address->>'place_id', ''),
        geocoded_at = case when v_lat is null then null else now() end,
        is_default = v_default
    where id = v_id and customer_id = p_customer_id and shop_id = p_shop_id;
    if not found then
      raise exception 'Không tìm thấy địa chỉ' using errcode = 'P0002';
    end if;
  end if;

  return v_id;
end
$$;

create or replace function public.delete_customer_address(p_shop_id uuid, p_address_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer uuid;
  v_was_default boolean;
begin
  if not public.can_manage_shop(p_shop_id) then
    raise exception 'Bạn không có quyền quản lý cửa hàng này' using errcode = '42501';
  end if;

  delete from public.customer_addresses
  where id = p_address_id and shop_id = p_shop_id
  returning customer_id, is_default into v_customer, v_was_default;
  if not found then
    raise exception 'Không tìm thấy địa chỉ' using errcode = 'P0002';
  end if;

  if v_was_default then
    update public.customer_addresses set is_default = true
    where id = (
      select id from public.customer_addresses
      where customer_id = v_customer order by created_at limit 1
    );
  end if;
end
$$;

select public._apply_grants();
