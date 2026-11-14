import { supabase } from './supabase'

export const PRODUCT_IMAGE_BUCKET = 'product-images'

/** Public URL of a product image stored under `path` (null when there is none). */
export function productImageUrl(path: string | null | undefined): string | null {
  return path ? supabase.storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(path).data.publicUrl : null
}
