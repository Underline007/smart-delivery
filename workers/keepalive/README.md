# Cloudflare Worker: keepalive

Gọi `keepalive()` của Supabase hai lần mỗi ngày, độc lập với GitHub Actions, để project miễn phí không bị tạm dừng. Cả hai cùng chạy là cố ý: một bên hỏng thì bên kia vẫn giữ được project.

Cài đặt: xem [docs/SETUP.md](../../docs/SETUP.md), mục “Giữ Supabase không bị tạm dừng”.

Kiểm tra: mở địa chỉ `https://smart-delivery-keepalive.<tài khoản>.workers.dev` trên trình duyệt, sẽ thấy `{"ok":true,"heartbeat":{...}}`.
