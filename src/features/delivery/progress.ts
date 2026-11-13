import type { Trip } from './api'

export function tripProgress(trip: Trip) {
  const delivered = trip.stops.filter((s) => s.status === 'delivered').length
  const failed = trip.stops.filter((s) => s.status === 'failed').length
  return { delivered, failed, total: trip.stops.length, pending: trip.stops.length - delivered - failed }
}
