/** Largest size that fits in a `max` × `max` box, keeping the ratio and never enlarging. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/**
 * Shrinks a photo to a small JPEG (about 50–100 KB) before upload, so the 1 GB of
 * free storage lasts. Runs in the browser.
 */
export async function compressImage(file: Blob, options: { maxDim?: number; quality?: number } = {}): Promise<Blob> {
  const { maxDim = 900, quality = 0.6 } = options
  const bitmap = await createImageBitmap(file)
  const { width, height } = fitWithin(bitmap.width, bitmap.height, maxDim)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Không xử lý được ảnh')
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Không nén được ảnh'))), 'image/jpeg', quality),
  )
}
