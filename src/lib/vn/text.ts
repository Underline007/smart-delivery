/** Lower case, no diacritics, đ → d. Same idea as the SQL function vn_search_key. */
export function searchKey(text: string | null | undefined): string {
  return (text ?? '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/** "Áo thun basic" → "AO-THUN-BASIC" */
export function slugUpper(text: string): string {
  return searchKey(text)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase()
}
