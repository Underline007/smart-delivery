const vnd = new Intl.NumberFormat('vi-VN')

/** 1250000 → "1.250.000đ" */
export function formatMoney(amount: number | string | null | undefined): string {
  return `${vnd.format(Number(amount ?? 0))}đ`
}

/** 1250000 → "1.250.000" */
export function formatNumber(value: number | string | null | undefined): string {
  return vnd.format(Number(value ?? 0))
}

/** "150" → 150, "1.250.000" → 1250000 (digits only, empty → 0). */
export function parseMoney(input: string): number {
  const digits = input.replace(/\D/g, '')
  return digits ? Number(digits) : 0
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date(iso))
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date(iso))
}

/** Today in Vietnam as YYYY-MM-DD. */
export function todayVn(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date())
}

/** 1250 → "1,25 kg", 800 → "800 g" */
export function formatWeight(grams: number): string {
  return grams >= 1000 ? `${(grams / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} kg` : `${grams} g`
}
