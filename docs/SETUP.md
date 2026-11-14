# Hướng dẫn cài đặt và triển khai

Làm theo thứ tự. Toàn bộ dùng gói **miễn phí**, không cần thẻ thanh toán (trừ Google Maps nếu sau này bạn chọn dùng, xem [mục 9](#9-google-maps-tuỳ-chọn)).

| Dịch vụ | Dùng để | Cần thẻ? |
|---|---|---|
| [GitHub](https://github.com) | Lưu mã nguồn, chạy kiểm thử, sao lưu, giữ DB thức | Không |
| [Supabase](https://supabase.com) | Cơ sở dữ liệu, đăng nhập, lưu ảnh, hàm phía server | Không |
| [Cloudflare Pages](https://pages.cloudflare.com) | Đưa app lên mạng (tên miền `*.pages.dev`) | Không |
| [OpenRouteService](https://openrouteservice.org) | Tối ưu tuyến theo đường thật (**tuỳ chọn**) | Không |

> **Lưu ý trung thực:** mã nguồn đã được kiểm thử bằng PostgreSQL thật (có mô phỏng phần đăng nhập/lưu file của Supabase) và trình duyệt Chromium giả lập điện thoại với dữ liệu giả. **Chưa được chạy với một project Supabase thật**, nên lần cài đặt đầu tiên hãy đi chậm và kiểm tra từng bước ở [mục 8](#8-kiểm-tra-sau-khi-cài-đặt).

## 1. Chuẩn bị

1. Repo này nên để **riêng tư** (Settings → General → Danger zone → Change visibility), vì app chứa dữ liệu khách hàng.
2. Cài trên máy bạn: Node.js 22+, [Supabase CLI](https://supabase.com/docs/guides/cli) (`npm i -g supabase` hoặc `npx supabase`).

## 2. Tạo project Supabase

1. Vào supabase.com → **New project**. Chọn vùng **Southeast Asia (Singapore)** cho nhanh, đặt mật khẩu database mạnh và **lưu lại**.
2. Vào **Project Settings → API**, ghi lại:
   - **Project URL** (dạng `https://xxxx.supabase.co`)
   - **Publishable key** (khoá công khai, dùng trong app)
   - **service_role key** (khoá bí mật: **không** đưa vào app, không gửi cho ai)
3. **Tắt đăng ký công khai:** Authentication → Sign In / Providers → tắt **Allow new users to sign up**. Đặt độ dài mật khẩu tối thiểu 8 (Authentication → Policies, hoặc theo `supabase/config.toml`).

## 3. Tạo bảng và quyền truy cập (migration)

Có hai cách, chọn một:

**Cách A, dùng Supabase CLI (khuyên dùng):**

```bash
npx supabase login
npx supabase link --project-ref <mã project, nằm trong URL>
npx supabase db push
```

**Cách B, dán tay:** mở **SQL Editor**, lần lượt dán và chạy từng file trong `supabase/migrations/` **theo thứ tự tên file** (`…0100_m0…` → `…0800_keepalive…`). Mỗi file chạy một lần, không chạy lại.

> Mỗi migration kết thúc bằng `select public._apply_grants();`. Dòng này khoá quyền truy cập: người chưa đăng nhập không đọc được bảng nào và chỉ gọi được hàm `keepalive()`. **Đừng bỏ nó.**

## 4. Triển khai 3 hàm phía server (Edge Functions)

```bash
npx supabase functions deploy admin-users
npx supabase functions deploy resolve-map-link
npx supabase functions deploy optimize-route
```

Đặt khoá bí mật (chỉ cần nếu muốn đổi/ dùng):

```bash
# Tên miền dùng để biến SĐT thành email nội bộ khi đăng nhập (xem mục Sự cố nếu bị báo email không hợp lệ).
npx supabase secrets set LOGIN_EMAIL_DOMAIN=phone.smart-delivery.invalid

# Tuỳ chọn: tối ưu tuyến theo đường thật. Lấy key miễn phí ở openrouteservice.org (Dashboard → Request a token).
npx supabase secrets set ORS_API_KEY=<key>
```

| Hàm | Việc làm | Bắt buộc? |
|---|---|---|
| `admin-users` | Admin tạo / khoá tài khoản, đặt lại mật khẩu | **Có** |
| `resolve-map-link` | Đọc vị trí từ link Google Maps rút gọn (`maps.app.goo.gl`) | Nên có |
| `optimize-route` | Tối ưu tuyến bằng OpenRouteService | Không. Không có thì app tối ưu ngay trên máy |

## 5. Tạo tài khoản admin đầu tiên

Trên máy bạn, trong thư mục dự án:

```bash
npm ci
SUPABASE_URL=https://xxxx.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service_role key> \
node scripts/create-admin.mjs --phone 0912345678 --name "Họ và tên"
```

Script in ra **mật khẩu tạm**. Đăng nhập bằng SĐT + mật khẩu tạm, app sẽ bắt đổi mật khẩu ở lần đầu. Các tài khoản khác (chủ cửa hàng, shipper) do admin tạo trong app: **Tài khoản → Tạo**.

## 6. Đưa app lên Cloudflare Pages

1. Cloudflare → **Workers & Pages → Create → Pages → Connect to Git**, chọn repo này.
2. Cấu hình build:
   - Build command: `npm run build`
   - Build output directory: `dist`
3. **Environment variables** (cả Production và Preview):

| Biến | Giá trị |
|---|---|
| `NODE_VERSION` | `22` |
| `VITE_SUPABASE_URL` | Project URL ở mục 2 |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Publishable key ở mục 2 |
| `VITE_LOGIN_EMAIL_DOMAIN` | **Giống** `LOGIN_EMAIL_DOMAIN` ở mục 4 |

4. Bấm **Save and Deploy**. Mỗi lần bạn push lên nhánh chính, app tự cập nhật.
5. Bổ sung URL của app (`https://<tên>.pages.dev`) vào Supabase → Authentication → URL Configuration → **Site URL**.

## 7. GitHub Actions (kiểm thử, giữ DB thức, sao lưu, dọn ảnh)

Vào repo → Settings → Secrets and variables → Actions → **New repository secret**:

| Secret | Dùng cho | Lấy ở đâu |
|---|---|---|
| `SUPABASE_URL` | keepalive, cleanup | Mục 2 |
| `SUPABASE_PUBLISHABLE_KEY` | keepalive | Mục 2 |
| `SUPABASE_SERVICE_ROLE_KEY` | cleanup (xoá ảnh giao hàng > 30 ngày) | Mục 2 |
| `SUPABASE_DB_URL` | backup | Project Settings → Database → Connection string (**Session pooler**) |
| `BACKUP_AGE_RECIPIENT` | backup | Khoá **công khai** `age1…` (bên dưới) |

Tạo cặp khoá mã hoá bản sao lưu (làm trên máy bạn, một lần):

```bash
age-keygen -o backup-key.txt     # cài age: https://github.com/FiloSottile/age
```

- Dòng `Public key: age1…` → đưa vào secret `BACKUP_AGE_RECIPIENT`.
- File `backup-key.txt` chứa **khoá riêng**: cất ở nơi an toàn **ngoài GitHub** (quản lý mật khẩu, USB). Mất khoá này là không giải mã được bản sao lưu.

| Workflow | Chạy khi | Việc làm |
|---|---|---|
| `ci.yml` | mỗi lần push / PR | lint, kiểm tra kiểu, test đơn vị, test DB, test giao diện điện thoại, build |
| `keepalive.yml` | 2 lần mỗi ngày | gọi `keepalive()` (ghi 1 dòng nhịp tim) rồi **kiểm tra kết quả**; hỏng thì báo lỗi. Xem mục “Giữ Supabase không bị tạm dừng” |
| `backup.yml` | Chủ nhật hằng tuần | sao lưu DB, mã hoá, giữ 90 ngày (Actions → chạy → tải artifact) |
| `cleanup.yml` | hằng ngày | xoá ảnh bằng chứng giao hàng quá 30 ngày |

**Khôi phục từ bản sao lưu:**

```bash
age -d -i backup-key.txt smart-delivery-public-20261115.sql.gz.age | gunzip > public.sql
psql "<chuỗi kết nối DB của project mới>" -f public.sql
```

(Chạy migration ở mục 3 cho project trống trước, hoặc khôi phục vào project trống rồi tạo lại tài khoản đăng nhập từ file `auth`.) Nên thử khôi phục vào một project Supabase trống **mỗi quý** để chắc chắn bản sao lưu dùng được.

## Giữ Supabase không bị tạm dừng

**Vấn đề:** gói miễn phí của Supabase **tạm dừng project sau khoảng 1 tuần không có hoạt động**. Project bị dừng thì app không vào được cho tới khi admin bấm *Restore*. Với một app cá nhân dùng đều thì ít gặp, nhưng khi nghỉ vài ngày (Tết, đi xa…) thì rất dễ xảy ra, nên app có nhiều lớp phòng ngừa.

> **Không có lớp nào bảo đảm 100%.** Supabase không công bố chính xác thế nào là “hoạt động”. Cách làm dưới đây (gọi API **và ghi** vào database, nhiều nơi, nhiều lần mỗi ngày) là cách phổ biến và hợp lý nhất, nhưng bạn vẫn nên coi thẻ cảnh báo trong app và bản sao lưu là lưới an toàn cuối cùng.

### Các lớp bảo vệ

| Lớp | Việc làm | Bạn cần làm |
|---|---|---|
| 1. **Dùng app hằng ngày** | Mỗi lần ai đó mở app là có hoạt động thật | — |
| 2. **GitHub Actions** (`keepalive.yml`) | 2 lần/ngày gọi `keepalive()`, hàm này **ghi** 1 dòng “nhịp tim” (tối đa 1 lần/giờ, không ai lạm dụng được). Sau đó workflow **kiểm tra** nhịp tim còn mới, nếu không thì **báo lỗi và GitHub gửi email** | Đặt 2 secret `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (mục 7) |
| 3. **Cloudflare Worker** (`workers/keepalive`) | Một bộ gọi **thứ hai, độc lập** với GitHub, 2 lần/ngày. Một bên hỏng thì bên kia vẫn chạy | Làm các bước bên dưới (khoảng 5 phút) |
| 4. **Thẻ cảnh báo cho admin** | Trang **Hệ thống** hiện “lần gọi gần nhất”: xanh (dưới 36 giờ), vàng (các lần gọi đã dừng), **đỏ (từ 5 ngày: sắp bị dừng)** | Mở trang này thỉnh thoảng |
| 5. **Sao lưu hằng tuần** (`backup.yml`) | Dù chuyện gì xảy ra, dữ liệu vẫn có bản mã hoá trong 90 ngày | Mục 7 |
| 6. **Màn hình báo lỗi rõ ràng** | Không vào được app thì màn đăng nhập giải thích có thể project bị dừng và cách xử lý | — |

### Cài Cloudflare Worker (lớp 3)

Cần tài khoản Cloudflare (đã có ở mục 6) và Node.js:

```bash
cd workers/keepalive
npx wrangler login
npx wrangler secret put SUPABASE_URL              # dán Project URL
npx wrangler secret put SUPABASE_PUBLISHABLE_KEY  # dán publishable key
npx wrangler deploy
```

Kiểm tra: mở địa chỉ `https://smart-delivery-keepalive.<tài khoản>.workers.dev` trên trình duyệt, thấy `{"ok":true,"heartbeat":{…}}` là chạy. Cron chạy lúc 09:41 và 21:41 UTC mỗi ngày (Cloudflare → Workers → *smart-delivery-keepalive* → Triggers).

### Những điểm yếu cần biết

- **Repo công khai thì GitHub tự tắt workflow định kỳ** sau 60 ngày không có hoạt động trên repo. Giữ repo **riêng tư** (đã khuyên ở mục 1) hoặc thỉnh thoảng bấm *Run workflow*.
- GitHub có thể chạy workflow **trễ** vào giờ cao điểm; vì vậy chạy 2 lần/ngày và có Worker song song.
- Email báo lỗi của GitHub gửi cho người cập nhật workflow gần nhất. Kiểm tra mục Notifications của GitHub nếu bạn không thấy mail.
- Hai bộ gọi dùng **publishable key** (khoá công khai), không dùng `service_role`.

### Nếu project đã bị tạm dừng

1. Vào supabase.com → chọn project → bấm **Restore project**. Chờ vài phút. **Dữ liệu không mất.**
2. Theo tài liệu Supabase tại thời điểm viết, project tạm dừng **khôi phục được trong khoảng 90 ngày**; sau đó chỉ còn tải được bản sao lưu. Hãy tra lại trang chính sách hiện hành của Supabase.
3. Quá hạn khôi phục: tạo project mới, chạy lại các migration (mục 3), khôi phục bản sao lưu (mục 7), tạo lại tài khoản bằng file sao lưu `auth`.
4. Tìm nguyên nhân: workflow `keepalive` có xanh không? Worker có chạy không? Repo có bị tắt workflow không?

### Phương án cuối cùng

Nếu việc bị tạm dừng gây thiệt hại thật cho việc bán hàng, nâng project lên gói **Pro (khoảng 25 USD/tháng)** là cách duy nhất loại bỏ hẳn việc tạm dừng. Đó là lúc kế hoạch “hạ tầng 0đ” không còn đủ, và là quyết định của bạn.

## 8. Kiểm tra sau khi cài đặt

Làm lần lượt, tick từng mục:

- [ ] Mở link `*.pages.dev` trên điện thoại, thấy màn đăng nhập (không báo “Chưa cấu hình kết nối”).
- [ ] Đăng nhập bằng admin vừa tạo, đổi mật khẩu thành công.
- [ ] Tab **Hệ thống** hiện số liệu và dung lượng DB.
- [ ] **Cửa hàng → Thêm**: tạo một cửa hàng. **Tài khoản → Tạo**: tạo một chủ cửa hàng và một shipper (mật khẩu tạm hiện **một lần**).
- [ ] Gán chủ cửa hàng vào shop (mở shop → Thêm làm chủ cửa hàng). Đăng nhập bằng chủ cửa hàng, vào **Cài đặt → Shipper của shop** và thêm shipper.
- [ ] Chủ cửa hàng: thêm sản phẩm có màu/size, nhập kho, tạo đơn, xác nhận (tồn kho giảm đúng).
- [ ] Đăng nhập bằng shipper (trình duyệt khác hoặc cửa sổ ẩn danh): **không** thấy giá vốn hay doanh thu.
- [ ] Admin: **Cài đặt → Danh mục tỉnh / xã** → nhập file phường/xã (CSV). **Cài đặt → Mẫu Excel ViettelPost** → tải file mẫu thật lên và chọn cột (xem [mục 10](#10-chuẩn-bị-dữ-liệu-cho-viettelpost)).
- [ ] Trên điện thoại: bấm **Cài đặt / Thêm vào màn hình chính** để cài app. Thử chụp ảnh khi giao hàng và mở **Dẫn đường**.
- [ ] Actions → chạy tay `keepalive` và `backup` một lần, thấy xanh. Tải lại trang **Hệ thống** của admin: thẻ “Giữ Supabase không bị tạm dừng” báo xanh.
- [ ] (Khuyên làm) Cài thêm Cloudflare Worker `keepalive` làm lớp bảo vệ thứ hai (mục dưới).

## 9. Google Maps (tuỳ chọn)

Bản này dùng **OpenStreetMap** (không cần thẻ) cho bản đồ trong app và **Google Maps app** để dẫn đường (miễn phí, không cần khoá). Gợi ý địa chỉ khi gõ và tự tìm toạ độ từ địa chỉ chữ (“Cách A” trong kế hoạch) **chưa được làm** trong bản này, vì cần khai báo thẻ thanh toán với Google. Vị trí giao hàng lấy từ:

1. link Google Maps khách gửi (dán vào ô “Dán link Google Maps”),
2. ghim trên bản đồ,
3. GPS của shipper ở lần giao đầu tiên (tự lưu cho các lần sau).

## 10. Chuẩn bị dữ liệu cho ViettelPost

Các việc dưới đây **cần file thật của bạn** nên chưa thể làm sẵn:

1. **File mẫu “Tạo đơn hàng loạt”:** tải từ tài khoản ViettelPost (nếu là `.xls` cũ, mở bằng Excel rồi lưu thành `.xlsx`). Admin vào **Cài đặt → Mẫu Excel ViettelPost → Chọn file .xlsx**, kiểm tra app đoán đúng cột (sửa nếu sai), điền đúng chữ cho các lựa chọn “người trả cước”, “yêu cầu khi giao”, rồi **Lưu mẫu**. Bấm **Tải file thử** để xem file xuất ra.
2. **Danh mục phường/xã:** lấy danh sách theo đúng tên ViettelPost dùng (hoặc danh mục chính thức sau sáp nhập 2025: 34 tỉnh, 3.321 xã/phường) dưới dạng CSV có 3 cột *mã xã, tên xã, tỉnh*, rồi nhập ở **Danh mục tỉnh / xã**. Chưa nhập thì địa chỉ vẫn dùng được nhưng phải gõ tên phường/xã tay và app cảnh báo khi xuất file.
3. **Thử thật:** tạo 3–5 đơn ViettelPost, xuất file, tải lên ViettelPost, xem có dòng nào báo lỗi không. Chỉnh cột / danh mục cho đến khi không còn lỗi, rồi mới dùng hằng ngày.

## 11. Giới hạn của gói miễn phí cần biết

| Dịch vụ | Giới hạn | Việc app làm |
|---|---|---|
| Supabase | 500 MB database, 1 GB file, 5 GB băng thông/tháng, tạm dừng sau 7 ngày không dùng | Trang admin cảnh báo khi DB > 70%; ảnh được nén; ảnh giao hàng tự xoá sau 30 ngày; workflow giữ DB thức |
| Cloudflare Pages | 500 lượt build/tháng | Dư dùng |
| GitHub Actions | 2.000 phút/tháng với repo riêng tư | Dùng khoảng vài chục phút/tháng |
| OpenRouteService | vài trăm lượt tối ưu mỗi ngày | Hết lượt thì tự dùng thuật toán trên máy |
| OpenStreetMap tiles | dùng nhẹ, ghi nguồn | Chỉ tải khi mở bản đồ |

Con số có thể thay đổi, hãy tra lại trang giá của từng dịch vụ.

## Sự cố thường gặp

| Hiện tượng | Cách xử lý |
|---|---|
| Màn hình “Chưa cấu hình kết nối” | Chưa đặt `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` trong Cloudflare, sau đó phải deploy lại |
| Admin tạo tài khoản báo “email không hợp lệ” | Supabase từ chối tên miền `.invalid`. Đặt `LOGIN_EMAIL_DOMAIN` (function) **và** `VITE_LOGIN_EMAIL_DOMAIN` (Cloudflare) cùng một tên miền khác, ví dụ tên miền bạn sở hữu. Email này không bao giờ gửi thư. Tài khoản đã tạo trước đó phải tạo lại |
| “Sai số điện thoại hoặc mật khẩu” dù đúng | Hai biến tên miền ở trên không khớp nhau |
| Màn đăng nhập báo “Không kết nối được máy chủ” dù mạng tốt | Project Supabase có thể đã bị tạm dừng: xem mục “Giữ Supabase không bị tạm dừng” → “Nếu project đã bị tạm dừng” |
| Không tải được ảnh sản phẩm / ảnh giao hàng | Kiểm tra migration `…0700_m6…` đã chạy (tạo kho ảnh và quyền) |
| Link `maps.app.goo.gl` không đọc được | Kiểm tra đã deploy `resolve-map-link`; hoặc mở link, copy link dài / toạ độ rồi dán |
| Nút “Tối ưu tuyến” không dùng đường thật | Chưa đặt `ORS_API_KEY` hoặc hết lượt. App vẫn sắp xếp được trên máy |
| Cài PWA trên iPhone | Dùng Safari → Chia sẻ → **Thêm vào Màn hình chính** |

## Chạy trên máy để phát triển

```bash
npm ci
cp .env.example .env.local        # điền URL và key của project Supabase
npm run dev                        # http://localhost:5173

npm run lint && npm run typecheck  # kiểm tra
npm test                           # test đơn vị
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run test:db   # test DB (cần PostgreSQL)
npm run test:e2e                   # test giao diện điện thoại (Playwright, dữ liệu giả)
```
