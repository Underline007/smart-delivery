import { normalizeVnMobile } from './phone'
import { searchKey } from './text'

export interface Province {
  code: string
  name: string
}
export interface Ward {
  code: string
  province_code: string
  name: string
}
export interface Alias {
  alias_search: string
  /** province_code for province aliases, ward_code for ward aliases */
  code: string
}

// ---------------------------------------------------------------- tokens

interface Token {
  /** lower case, no diacritics */
  t: string
  start: number
  end: number
}

/** Same length as the input (NFC), so indexes map back to the original text. */
function alignedKey(text: string): string {
  return Array.from(text)
    .map((ch) => {
      const key = searchKey(ch)
      return key.length === 1 ? key : (key[0] ?? ' ')
    })
    .join('')
}

function tokenize(text: string): Token[] {
  const aligned = alignedKey(text)
  const tokens: Token[] = []
  for (const m of aligned.matchAll(/[a-z0-9]+/g)) {
    tokens.push({ t: m[0], start: m.index, end: m.index + m[0].length })
  }
  return tokens
}

function words(text: string): string[] {
  return tokenize(text.normalize('NFC')).map((t) => t.t)
}

function findSequence(tokens: Token[], seq: string[]): number[] {
  const hits: number[] = []
  if (seq.length === 0) return hits
  for (let i = 0; i + seq.length <= tokens.length; i++) {
    if (seq.every((word, j) => tokens[i + j].t === word)) hits.push(i)
  }
  return hits
}

function startsWith(seq: string[], prefix: string[]): boolean {
  return prefix.every((p, i) => seq[i] === p)
}

// ---------------------------------------------------------------- message → name / phone / address

const PHONE_PATTERN = /(?:(?:\+|\b)84(?:[\s.-]?\d){9}|\b0(?:[\s.-]?\d){9})(?!\d)/g

/** Finds the first valid Vietnamese mobile number in free text. */
export function extractPhone(text: string): { phone: string; start: number; end: number } | null {
  for (const m of text.matchAll(PHONE_PATTERN)) {
    const phone = normalizeVnMobile(m[0])
    if (phone) return { phone, start: m.index, end: m.index + m[0].length }
  }
  return null
}

const ADMIN_WORDS = new Set([
  'phuong', 'xa', 'quan', 'huyen', 'thi', 'thanh', 'tinh', 'tp', 'tx', 'tt', 'duong', 'pho', 'so', 'ngo',
  'hem', 'kiet', 'ap', 'thon', 'khu', 'to', 'khom',
])

function looksLikeName(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed.length === 0 || trimmed.length > 40) return false
  if (/\d/.test(trimmed)) return false
  return !words(trimmed).some((w) => ADMIN_WORDS.has(w))
}

// Labels are matched on the accent-free form of a line.
const PHONE_LABEL = /^(?:so\s+)?(?:sdt|dt|dien thoai|phone|tel|zalo)\b\s*[:.-]?\s*/
const NAME_LABEL = /^(?:ten|ho ten|ho va ten|nguoi nhan|khach)\b\s*[:-]\s*/
const ADDRESS_LABEL = /^(?:dia chi|d\/c|dc)\b\s*[:-]\s*/
const TRAILING_PHONE_LABEL = /\s*(?:so\s+)?(?:sdt|dt|dien thoai|phone|tel|zalo)\s*[:.-]?\s*$/

/** Returns the text after a leading label, or null when the line has no such label. */
function stripLabel(line: string, label: RegExp): string | null {
  const nfc = line.normalize('NFC')
  const match = alignedKey(nfc).match(label)
  return match ? nfc.slice(match[0].length).trim() : null
}

function stripTrailingPhoneLabel(text: string): string {
  const nfc = text.normalize('NFC')
  const match = alignedKey(nfc).match(TRAILING_PHONE_LABEL)
  return match ? nfc.slice(0, match.index) : nfc
}

function cleanEdges(text: string): string {
  return text.replace(/^[\s,;:.\-–]+|[\s,;:.\-–]+$/g, '').replace(/\s+/g, ' ')
}

export interface SplitMessage {
  name: string
  phone: string
  address: string
}

/**
 * Splits a pasted chat message into name, phone and address text.
 * Understands "Tên: …", "SĐT: …", "Địa chỉ: …" labels; otherwise uses position
 * (text before the phone on its line, or the first short line without digits,
 * is the name; the rest is the address).
 */
export function splitMessage(raw: string): SplitMessage {
  const text = raw.normalize('NFC').replace(/\r/g, '')
  const found = extractPhone(text)

  interface Segment {
    text: string
    /** Text that stood in front of the phone number on its line. */
    beforePhone?: boolean
  }
  const segments: Segment[] = []
  let offset = 0
  for (const line of text.split('\n')) {
    const lineStart = offset
    offset += line.length + 1
    if (found && found.start >= lineStart && found.start < lineStart + line.length + 1) {
      segments.push({
        text: stripTrailingPhoneLabel(line.slice(0, found.start - lineStart)),
        beforePhone: true,
      })
      segments.push({ text: line.slice(found.end - lineStart) })
    } else {
      segments.push({ text: line })
    }
  }

  let name = ''
  let address = ''
  const rest: Segment[] = []

  for (const segment of segments) {
    let line = cleanEdges(segment.text)
    if (!line) continue

    const afterPhoneLabel = stripLabel(line, PHONE_LABEL)
    if (afterPhoneLabel !== null) {
      line = cleanEdges(afterPhoneLabel)
      if (!line) continue
    }
    const nameValue = stripLabel(line, NAME_LABEL)
    if (nameValue !== null) {
      name = cleanEdges(nameValue)
      continue
    }
    const addressValue = stripLabel(line, ADDRESS_LABEL)
    if (addressValue !== null) {
      address = cleanEdges(addressValue)
      continue
    }
    rest.push({ ...segment, text: line })
  }

  if (!name) {
    // Prefer the text right before the phone ("Chị Lan 0912…"), then the first short line.
    const index =
      rest.findIndex((s) => s.beforePhone && looksLikeName(s.text)) >= 0
        ? rest.findIndex((s) => s.beforePhone && looksLikeName(s.text))
        : rest.findIndex((s) => looksLikeName(s.text))
    if (index >= 0) {
      name = rest[index].text
      rest.splice(index, 1)
    }
  }

  if (!address) address = rest.map((s) => cleanEdges(s.text)).filter(Boolean).join(', ')
  return { name: cleanEdges(name), phone: found?.phone ?? '', address: cleanEdges(address) }
}

// ---------------------------------------------------------------- address → province / ward / detail

export interface ProvinceMatch {
  code: string
  start: number
  end: number
}

const PROVINCE_PREFIXES = [['thanh', 'pho'], ['tp'], ['tinh']]

/** Finds the province named in an address (the last mention wins, e.g. "…, Q1, HCM"). */
export function matchProvince(
  address: string,
  provinces: Province[],
  aliases: Alias[],
): ProvinceMatch | null {
  const text = address.normalize('NFC')
  const tokens = tokenize(text)
  let best: (ProvinceMatch & { len: number; index: number }) | null = null

  const consider = (code: string, seq: string[]) => {
    for (const index of findSequence(tokens, seq)) {
      let first = index
      for (const prefix of PROVINCE_PREFIXES) {
        const from = first - prefix.length
        if (from >= 0 && prefix.every((p, j) => tokens[from + j].t === p)) {
          first = from
          break
        }
      }
      const candidate = {
        code,
        start: tokens[first].start,
        end: tokens[index + seq.length - 1].end,
        len: seq.length,
        index,
      }
      if (!best || candidate.index > best.index || (candidate.index === best.index && candidate.len > best.len)) {
        best = candidate
      }
    }
  }

  for (const province of provinces) {
    const full = words(province.name)
    consider(province.code, full)
    const stripped = PROVINCE_PREFIXES.find((p) => startsWith(full, p))
    if (stripped) consider(province.code, full.slice(stripped.length))
  }
  for (const alias of aliases) consider(alias.code, words(alias.alias_search))

  if (!best) return null
  const { code, start, end } = best
  return { code, start, end }
}

const WARD_PREFIXES = [['thi', 'tran'], ['dac', 'khu'], ['phuong'], ['xa'], ['tt'], ['p']]

export interface WardMatch {
  code: string
  name: string
  start: number
  end: number
}

/** Ward candidates found in the address, best first. `wards` should be those of the detected province. */
export function matchWards(address: string, wards: Ward[], aliases: Alias[] = []): WardMatch[] {
  const text = address.normalize('NFC')
  const tokens = tokenize(text)
  const byCode = new Map(wards.map((w) => [w.code, w]))
  const found = new Map<string, WardMatch & { score: number; index: number }>()

  const consider = (ward: Ward, seq: string[], mustHavePrefix: boolean, trusted = false) => {
    for (const index of findSequence(tokens, seq)) {
      let first = index
      let hasPrefix = false
      for (const prefix of WARD_PREFIXES) {
        const from = first - prefix.length
        if (from >= 0 && prefix.every((p, j) => tokens[from + j].t === p)) {
          first = from
          hasPrefix = true
          break
        }
      }
      // A lone word like "an" or "binh" is too ambiguous without "phường/xã" in front.
      if ((mustHavePrefix || (seq.length === 1 && !trusted)) && !hasPrefix) continue
      const candidate = {
        code: ward.code,
        name: ward.name,
        start: tokens[first].start,
        end: tokens[index + seq.length - 1].end,
        score: seq.length + (hasPrefix ? 1 : 0),
        index,
      }
      const previous = found.get(ward.code)
      if (!previous || candidate.score > previous.score) found.set(ward.code, candidate)
    }
  }

  for (const ward of wards) {
    const fullWords = words(ward.name)
    const stripped = WARD_PREFIXES.find((p) => startsWith(fullWords, p))
    const short = stripped ? fullWords.slice(stripped.length) : fullWords
    if (short.length === 0) continue
    // "Phường 1", "Phường 12": the number alone means nothing, the prefix is required.
    consider(ward, short, short.every((w) => /^\d+$/.test(w)))
  }
  for (const alias of aliases) {
    const ward = byCode.get(alias.code)
    if (ward) consider(ward, words(alias.alias_search), false, true)
  }

  return [...found.values()]
    .sort((a, b) => b.score - a.score || b.index - a.index)
    .slice(0, 3)
    .map(({ code, name, start, end }) => ({ code, name, start, end }))
}

const DISTRICT_WORDS = new Set(['quan', 'huyen', 'tx', 'tt', 'tinh'])

/**
 * Where the street part of an address ends: at the first "phường / xã / quận /
 * huyện / TP / tỉnh", or "P.3", "Q1", "H.Cu Chi".
 */
function adminStart(text: string): number {
  const tokens = tokenize(text)
  for (let i = 0; i < tokens.length; i++) {
    const { t } = tokens[i]
    const next = tokens[i + 1]
    const after = text[tokens[i].end]
    const isWord =
      t === 'phuong' ||
      DISTRICT_WORDS.has(t) ||
      (t === 'xa' && next?.t !== 'lo') ||
      (t === 'thi' && (next?.t === 'xa' || next?.t === 'tran')) ||
      (t === 'thanh' && next?.t === 'pho') ||
      t === 'tp'
    const isShort =
      ['p', 'q', 'h'].includes(t) && (after === '.' || /^\d+$/.test(next?.t ?? '')) && i > 0
    const isGlued = /^[pqh]\d{1,2}$/.test(t) && i > 0
    if ((isWord || isShort || isGlued) && i > 0) return tokens[i].start
  }
  return text.length
}

function titleCase(text: string): string {
  return text
    .toLowerCase()
    .split(/(\s+)/)
    .map((part) => (part.trim() ? part[0].toUpperCase() + part.slice(1) : part))
    .join('')
}

export interface ParsedAddress {
  detail: string
  provinceCode: string | null
  wardCode: string | null
  /** Free-text ward when the catalogue has no match ("Phường Tân Hiệp"). */
  wardText: string
  wardCandidates: WardMatch[]
}

export interface AddressCatalog {
  provinces: Province[]
  provinceAliases: Alias[]
  /** Wards of the detected province (empty if unknown). */
  wards: Ward[]
  wardAliases?: Alias[]
}

/** Splits address text into street detail, province and ward. */
export function parseAddress(address: string, catalog: AddressCatalog): ParsedAddress {
  const text = address.normalize('NFC')
  const province = matchProvince(text, catalog.provinces, catalog.provinceAliases)
  const wards = province ? catalog.wards.filter((w) => w.province_code === province.code) : catalog.wards
  const candidates = matchWards(text, wards, catalog.wardAliases)
  const ward = candidates[0] ?? null

  let cut = adminStart(text)
  if (ward) cut = Math.min(cut, ward.start)
  if (province) cut = Math.min(cut, province.start)

  let wardText = ''
  if (!ward) {
    const tokens = tokenize(text)
    const wardPrefix = tokens.findIndex(
      (tok, i) => i > 0 && ['phuong', 'xa', 'tt'].includes(tok.t) && tokens[i + 1]?.t !== 'lo',
    )
    if (wardPrefix >= 0) {
      const from = tokens[wardPrefix].start
      const rest = text.slice(from)
      const stop = rest.search(/,|\b(?:quận|quan|huyện|huyen|tp|thành phố|thanh pho|tỉnh|tinh)\b/i)
      const end = province ? Math.min(province.start - from, stop >= 0 ? stop : rest.length) : stop >= 0 ? stop : rest.length
      wardText = titleCase(cleanEdges(rest.slice(0, Math.max(end, 0))))
    }
  }

  return {
    detail: cleanEdges(text.slice(0, cut)),
    provinceCode: province?.code ?? null,
    wardCode: ward?.code ?? null,
    wardText,
    wardCandidates: candidates,
  }
}
