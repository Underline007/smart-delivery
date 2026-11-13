const ACTION_LABELS: Record<string, string> = {
  'account.create': 'Tạo tài khoản',
  'account.update': 'Sửa tài khoản',
  'account.reset_password': 'Đặt lại mật khẩu',
  'account.lock': 'Khoá tài khoản',
  'account.unlock': 'Mở khoá tài khoản',
  'shop.create': 'Tạo cửa hàng',
  'shop.update': 'Sửa cửa hàng',
  'shop.update_info': 'Sửa thông tin cửa hàng',
  'shop.settings': 'Đổi cài đặt cửa hàng',
  'shop.owner_add': 'Gán chủ cửa hàng',
  'shop.owner_remove': 'Bỏ chủ cửa hàng',
  'shop.shipper_add': 'Thêm shipper vào shop',
  'shop.shipper_remove': 'Bỏ shipper khỏi shop',
  'system.settings': 'Đổi cài đặt hệ thống',
  'product.save': 'Lưu sản phẩm',
  'stock.receive': 'Nhập kho',
  'stock.stocktake': 'Kiểm kho',
  'order.cancel': 'Huỷ đơn',
  'order.reopen': 'Mở lại đơn',
  'trip.settle': 'Chốt tiền chuyến giao',
}

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action
}
