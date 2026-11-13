import { useQuery, type QueryClient } from '@tanstack/react-query'
import { parseAddress, splitMessage, type Alias, type Province, type Ward } from '@/lib/vn/address'
import { fetchProvinceAliases, fetchProvinces, fetchWardAliases, fetchWards } from './api'
import type { AddressDraft } from './address-draft'

const FOREVER = { staleTime: Infinity, gcTime: Infinity }

export function useProvinces() {
  return useQuery({ queryKey: ['catalog', 'provinces'], queryFn: fetchProvinces, ...FOREVER })
}

export function useWards(provinceCode: string | null) {
  return useQuery({
    queryKey: ['catalog', 'wards', provinceCode],
    queryFn: () => fetchWards(provinceCode!),
    enabled: Boolean(provinceCode),
    ...FOREVER,
  })
}

export interface PastedMessage {
  name: string
  phone: string
  address: AddressDraft
  /** What was recognised, for the confirmation summary. */
  found: { province: string | null; ward: string | null }
}

/** Splits a chat message and fills province / ward from the catalogue. */
export async function interpretMessage(raw: string, queryClient: QueryClient): Promise<PastedMessage> {
  const { name, phone, address } = splitMessage(raw)

  const provinces = await queryClient.fetchQuery<Province[]>({
    queryKey: ['catalog', 'provinces'],
    queryFn: fetchProvinces,
    ...FOREVER,
  })
  const provinceAliases = await queryClient.fetchQuery<Alias[]>({
    queryKey: ['catalog', 'province-aliases'],
    queryFn: fetchProvinceAliases,
    ...FOREVER,
  })

  // First pass finds the province, which tells us which wards to load.
  const first = parseAddress(address, { provinces, provinceAliases, wards: [] })
  let wards: Ward[] = []
  let wardAliases: Alias[] = []
  if (first.provinceCode) {
    wards = await queryClient.fetchQuery<Ward[]>({
      queryKey: ['catalog', 'wards', first.provinceCode],
      queryFn: () => fetchWards(first.provinceCode!),
      ...FOREVER,
    })
    wardAliases = await fetchWardAliases(wards.map((w) => w.code)).catch(() => [])
  }
  const parsed = wards.length > 0 ? parseAddress(address, { provinces, provinceAliases, wards, wardAliases }) : first

  return {
    name,
    phone,
    address: {
      detail: parsed.detail || address,
      provinceCode: parsed.provinceCode ?? '',
      wardCode: parsed.wardCode ?? '',
      wardText: parsed.wardCode ? '' : parsed.wardText,
      lat: null,
      lng: null,
      geoSource: null,
    },
    found: {
      province: provinces.find((p) => p.code === parsed.provinceCode)?.name ?? null,
      ward: wards.find((w) => w.code === parsed.wardCode)?.name ?? (parsed.wardText || null),
    },
  }
}
