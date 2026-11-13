import type { AddressInput, CustomerAddress, GeoSource } from './api'

/** Address being edited in a form. Empty strings mean "not set". */
export interface AddressDraft {
  detail: string
  provinceCode: string
  wardCode: string
  wardText: string
  lat: number | null
  lng: number | null
  geoSource: GeoSource | null
}

export const EMPTY_ADDRESS: AddressDraft = {
  detail: '',
  provinceCode: '',
  wardCode: '',
  wardText: '',
  lat: null,
  lng: null,
  geoSource: null,
}

export function draftFromAddress(address: CustomerAddress | undefined): AddressDraft {
  if (!address) return EMPTY_ADDRESS
  return {
    detail: address.detail,
    provinceCode: address.province_code ?? '',
    wardCode: address.ward_code ?? '',
    wardText: address.ward_text ?? '',
    lat: address.lat,
    lng: address.lng,
    geoSource: address.geo_source,
  }
}

export function addressInput(
  draft: AddressDraft,
  extra: { id?: string; label?: string; is_default?: boolean } = {},
): AddressInput {
  return {
    id: extra.id,
    label: extra.label ?? '',
    detail: draft.detail.trim(),
    province_code: draft.provinceCode || null,
    ward_code: draft.wardCode || null,
    ward_text: draft.wardCode ? '' : draft.wardText.trim(),
    lat: draft.lat,
    lng: draft.lng,
    geo_source: draft.lat === null ? null : draft.geoSource,
    is_default: extra.is_default ?? false,
  }
}

/** What is missing before an address can be used for delivery. */
export function addressProblems(draft: AddressDraft): string[] {
  const problems: string[] = []
  if (!draft.detail.trim()) problems.push('Nhập địa chỉ chi tiết (số nhà, đường)')
  if (!draft.provinceCode) problems.push('Chọn tỉnh/thành')
  return problems
}
