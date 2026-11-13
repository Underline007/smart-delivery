import { useState } from 'react'
import { toast } from 'sonner'
import { toMessage } from '@/lib/errors'
import { getPosition } from '@/lib/geo'
import { compressImage } from '@/lib/image'
import { completeStop, failStop, uploadProof } from './api'
import type { DeliverResult } from './StopSheets'

/**
 * Records delivery results: GPS fix, optional compressed photo, then the RPC.
 * A photo that fails to upload never blocks recording the delivery.
 */
export function useStopResults(trip: { id: string; shopId: string }, onDone: () => void | Promise<void>) {
  const [busy, setBusy] = useState(false)

  async function run(work: () => Promise<void>, success: string) {
    setBusy(true)
    try {
      await work()
      toast.success(success)
      await onDone()
    } catch (error) {
      toast.error(await toMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return {
    busy,
    deliver: (stopId: string, result: DeliverResult) =>
      run(async () => {
        const position = await getPosition(6000)
        let photo: string | null = null
        if (result.photo) {
          try {
            photo = await uploadProof(trip.shopId, trip.id, stopId, await compressImage(result.photo))
          } catch {
            toast.warning('Không tải được ảnh, vẫn ghi nhận đã giao')
          }
        }
        await completeStop(stopId, { cod: result.cod, lat: position?.lat ?? null, lng: position?.lng ?? null, photo, note: result.note })
      }, 'Đã ghi nhận giao thành công'),
    fail: (stopId: string, reason: string, note: string) => run(() => failStop(stopId, reason, note), 'Đã ghi nhận giao thất bại'),
  }
}
