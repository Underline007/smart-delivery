# Smart Delivery

Ứng dụng quản lý **cửa hàng, đơn hàng, kho (theo màu/size) và khách hàng**, với 3 vai trò **Admin · Chủ cửa hàng · Shipper**. Hỗ trợ shipper **sắp xếp tuyến giao** và dẫn đường bằng Google Maps, và **xuất file Excel để tạo đơn hàng loạt trên ViettelPost**.

Thiết kế ưu tiên **điện thoại** (PWA, cài lên màn hình chính). **Toàn bộ hạ tầng miễn phí** (Supabase + Cloudflare Pages + GitHub Actions).

## Tính năng chính

- **Kho**: sản phẩm có biến thể, nhập kho / kiểm kho dạng lưới màu × size, thẻ kho, cảnh báo sắp hết, giá vốn trung bình.
- **Khách hàng**: dán tin nhắn Zalo/Facebook để tự tách tên – SĐT – địa chỉ (theo 34 tỉnh sau sáp nhập), đọc link Google Maps, ghim bản đồ, cảnh báo khách hay hoàn hàng.
- **Đơn hàng**: tạo trong dưới 1 phút, trừ/cộng kho tự động và chính xác, vòng đời đầy đủ, chia sẻ tin nhắn xác nhận.
- **ViettelPost**: điền thẳng vào file Excel mẫu của bạn, kiểm tra lỗi trước khi xuất, lô xuất, nhập ngược mã vận đơn.
- **Giao hàng**: lập chuyến, tối ưu tuyến, màn hình shipper một tay (gọi, Zalo, dẫn đường, ảnh, thu COD), đối soát.
- **Nhiều cửa hàng**: dữ liệu mỗi shop tách biệt hoàn toàn; shipper dùng chung và chỉ thấy chuyến của mình.
- **Báo cáo**, xuất toàn bộ dữ liệu ra Excel, sao lưu mã hoá hằng tuần.

## Tài liệu

- **[docs/SETUP.md](docs/SETUP.md)**: cài đặt và triển khai từng bước
- **[docs/PLAN.md](docs/PLAN.md)**: kế hoạch chi tiết, thiết kế dữ liệu, giao diện, các điểm khác kế hoạch (mục 13)

## Trạng thái

Đã code xong toàn bộ kế hoạch và có kiểm thử tự động (163 test cơ sở dữ liệu, 203 test đơn vị, 45 test giao diện điện thoại). **Chưa chạy với Supabase và ViettelPost thật**: cần cài đặt và làm theo danh sách kiểm tra ở SETUP.md, và cần file mẫu ViettelPost của bạn (xem [docs/SETUP.md](docs/SETUP.md#10-chuẩn-bị-dữ-liệu-cho-viettelpost)).

## Chạy thử trên máy

```bash
npm ci
cp .env.example .env.local   # điền URL và key của project Supabase
npm run dev                  # http://localhost:5173
```

Kiểm thử: `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e`, và `DATABASE_URL=postgres://… npm run test:db`.

## Cấu trúc

```
src/features/        các module: auth, admin, shop, products, customers, orders, vtp, delivery, reports
src/lib/             tiện ích dùng chung (tách địa chỉ, link Maps, định dạng, ảnh…)
supabase/migrations/ cơ sở dữ liệu, phân quyền (RLS) và hàm nghiệp vụ, đánh số theo thứ tự chạy
supabase/functions/  admin-users, resolve-map-link, optimize-route
tests/db, tests/e2e  test cơ sở dữ liệu và test giao diện
.github/workflows/   CI, giữ DB thức, sao lưu, dọn ảnh
```
