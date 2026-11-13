export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** Saves a file through the browser's download mechanism. */
export function downloadFile(name: string, bytes: Uint8Array, mime = XLSX_MIME): void {
  const blob = new Blob([bytes as BlobPart], { type: mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Opens the share sheet (Zalo, Drive, email…) with the file. Returns false when sharing files is unsupported. */
export async function shareFile(name: string, bytes: Uint8Array, mime = XLSX_MIME): Promise<boolean> {
  const file = new File([bytes as BlobPart], name, { type: mime })
  if (typeof navigator.canShare !== 'function' || !navigator.canShare({ files: [file] })) return false
  try {
    await navigator.share({ files: [file], title: name })
  } catch (error) {
    if ((error as Error).name !== 'AbortError') throw error
  }
  return true
}

export async function readFileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer())
}
