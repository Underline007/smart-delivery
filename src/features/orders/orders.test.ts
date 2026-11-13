import { describe, expect, it } from 'vitest'
import { renderMessage, type MessageOrder } from './message'
import { isEditable, nextActions, STATUS_LABEL, type DeliveryMethod, type OrderStatus } from './status'
import { computeTotals } from './totals'

describe('computeTotals', () => {
  const lines = [
    { qty: 2, price: 150_000, weight_g: 250 },
    { qty: 1, price: 140_000, weight_g: 300 },
  ]

  it('matches the server arithmetic', () => {
    expect(computeTotals({ lines, shippingFee: 30_000, discount: 10_000, paid: 50_000, packagingWeight: 100 })).toEqual({
      subtotal: 440_000,
      total: 460_000,
      cod: 410_000,
      weight: 900,
      errors: [],
    })
  })

  it('uses a manual weight when given', () => {
    expect(computeTotals({ lines, shippingFee: 0, discount: 0, paid: 0, packagingWeight: 100, weightOverride: 1234 }).weight).toBe(1234)
  })

  it('flags a discount or payment that is too large', () => {
    const result = computeTotals({ lines, shippingFee: 0, discount: 999_999, paid: 999_999, packagingWeight: 0 })
    expect(result.errors).toHaveLength(2)
    expect(result.total).toBe(0)
  })

  it('handles an empty order', () => {
    expect(computeTotals({ lines: [], shippingFee: 0, discount: 0, paid: 0, packagingWeight: 100 })).toMatchObject({
      subtotal: 0,
      total: 0,
      cod: 0,
      weight: 100,
    })
  })
})

describe('renderMessage', () => {
  const order: MessageOrder = {
    code: 'AN261113-001',
    ship_name: 'Chị Lan',
    ship_full_text: '12 Lê Lợi, Phường Bến Thành, TP. Hồ Chí Minh',
    total: 460_000,
    cod_amount: 410_000,
    items: [
      { product_name: 'Áo thun', variant_label: 'Đỏ / M', qty: 2, unit_price: 150_000 },
      { product_name: 'Nón', variant_label: '', qty: 1, unit_price: 90_000 },
    ],
  }

  it('fills every variable', () => {
    const text = renderMessage('Chào {ten}, đơn {ma_don}:\n{san_pham}\nTổng {tong}đ, thu {cod}đ\n{dia_chi}', order)
    expect(text).toBe(
      'Chào Chị Lan, đơn AN261113-001:\n• Áo thun (Đỏ / M) x2 — 300.000đ\n• Nón x1 — 90.000đ\nTổng 460.000đ, thu 410.000đ\n12 Lê Lợi, Phường Bến Thành, TP. Hồ Chí Minh',
    )
  })

  it('keeps unknown variables and handles missing data', () => {
    expect(renderMessage('{ten} {khong_co}', { ...order, ship_name: null })).toBe('bạn {khong_co}')
    expect(renderMessage('{dia_chi}', { ...order, ship_full_text: null })).toBe('Nhận tại shop')
  })
})

describe('nextActions', () => {
  const statuses = Object.keys(STATUS_LABEL) as OrderStatus[]
  const methods: DeliveryMethod[] = ['self', 'vtp', 'pickup']

  // The database allows exactly these moves (see _order_transition_allowed).
  const allowed: Record<OrderStatus, OrderStatus[]> = {
    new: ['confirmed', 'cancelled'],
    confirmed: ['new', 'cancelled', 'vtp_exported', 'shipping', 'delivered'],
    vtp_exported: ['confirmed', 'shipping', 'delivered', 'cancelled'],
    shipping: ['delivered', 'failed', 'returning'],
    failed: ['shipping', 'returning'],
    returning: ['returned'],
    delivered: [],
    returned: [],
    cancelled: [],
  }

  it.each(statuses.flatMap((s) => methods.map((m) => [s, m] as const)))(
    'only offers moves the database allows (%s, %s)',
    (status, method) => {
      for (const action of nextActions(status, method)) expect(allowed[status]).toContain(action.to)
    },
  )

  it('never offers a way out of a final status', () => {
    for (const s of ['delivered', 'returned', 'cancelled'] as const) expect(nextActions(s, 'self')).toEqual([])
  })

  it('offers pickup orders a direct "delivered" but not "start delivery"', () => {
    const to = nextActions('confirmed', 'pickup').map((a) => a.to)
    expect(to).toContain('delivered')
    expect(to).not.toContain('shipping')
  })

  it('only new orders are editable', () => {
    expect(statuses.filter(isEditable)).toEqual(['new'])
  })
})
