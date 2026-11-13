import { haversine, type LatLng } from '@/lib/maps/link'

export type EndMode = 'return' | 'last'

export interface RouteResult {
  /** Indexes into the stops array, in visiting order. */
  order: number[]
  /** Straight-line length of the whole route in metres (including the way back for "return"). */
  distance: number
}

/** Real roads are longer than the straight line; used only for rough estimates. */
export const ROAD_FACTOR = 1.3
const SPEED_KMH = 25

export function estimateRoad(distanceM: number): { distance_m: number; duration_s: number } {
  const road = Math.round(distanceM * ROAD_FACTOR)
  return { distance_m: road, duration_s: Math.round((road / 1000 / SPEED_KMH) * 3600) }
}

/** Node 0 is the start, nodes 1..n are the stops. */
export function distanceMatrix(start: LatLng, stops: LatLng[]): number[][] {
  const nodes = [start, ...stops]
  return nodes.map((a) => nodes.map((b) => haversine(a, b)))
}

/** Length of start → order[0] → … → order[n-1] (→ start when mode is "return"). */
export function routeLength(order: number[], dist: number[][], mode: EndMode): number {
  let total = 0
  let at = 0
  for (const stop of order) {
    total += dist[at][stop + 1]
    at = stop + 1
  }
  if (mode === 'return') total += dist[at][0]
  return total
}

/** Exact solution (Held–Karp). Fine up to about 12 stops. */
export function solveExact(dist: number[][], mode: EndMode): number[] {
  const n = dist.length - 1
  if (n <= 1) return n === 1 ? [0] : []
  const full = (1 << n) - 1
  const cost = new Float64Array((full + 1) * n).fill(Infinity)
  const parent = new Int16Array((full + 1) * n).fill(-1)
  for (let j = 0; j < n; j++) cost[(1 << j) * n + j] = dist[0][j + 1]

  for (let mask = 1; mask <= full; mask++) {
    for (let last = 0; last < n; last++) {
      if (!(mask & (1 << last))) continue
      const here = cost[mask * n + last]
      if (here === Infinity) continue
      for (let next = 0; next < n; next++) {
        if (mask & (1 << next)) continue
        const nextMask = mask | (1 << next)
        const value = here + dist[last + 1][next + 1]
        if (value < cost[nextMask * n + next]) {
          cost[nextMask * n + next] = value
          parent[nextMask * n + next] = last
        }
      }
    }
  }

  let best = -1
  let bestCost = Infinity
  for (let last = 0; last < n; last++) {
    const value = cost[full * n + last] + (mode === 'return' ? dist[last + 1][0] : 0)
    if (value < bestCost) {
      bestCost = value
      best = last
    }
  }
  const order: number[] = []
  let mask = full
  let at = best
  while (at >= 0) {
    order.push(at)
    const previous = parent[mask * n + at]
    mask &= ~(1 << at)
    at = previous
  }
  return order.reverse()
}

/** Nearest neighbour from the start, then 2-opt until nothing improves. */
export function solveHeuristic(dist: number[][], mode: EndMode): number[] {
  const n = dist.length - 1
  if (n <= 1) return n === 1 ? [0] : []

  // Nearest neighbour
  const route = [0]
  const left = new Set(Array.from({ length: n }, (_, i) => i + 1))
  while (left.size > 0) {
    const from = route[route.length - 1]
    let best = -1
    let bestDistance = Infinity
    for (const candidate of left) {
      if (dist[from][candidate] < bestDistance) {
        bestDistance = dist[from][candidate]
        best = candidate
      }
    }
    route.push(best)
    left.delete(best)
  }
  if (mode === 'return') route.push(0)

  // 2-opt: reverse route[i..j] when that shortens the route. The start (index 0) never moves.
  const last = route.length - 1
  let improved = true
  while (improved) {
    improved = false
    for (let i = 1; i < last; i++) {
      for (let j = i + 1; j <= (mode === 'return' ? last - 1 : last); j++) {
        const before = dist[route[i - 1]][route[i]] + (j < last ? dist[route[j]][route[j + 1]] : 0)
        const after = dist[route[i - 1]][route[j]] + (j < last ? dist[route[i]][route[j + 1]] : 0)
        if (after < before - 1e-9) {
          for (let a = i, b = j; a < b; a++, b--) [route[a], route[b]] = [route[b], route[a]]
          improved = true
        }
      }
    }
  }
  return route.filter((node, index) => node !== 0 || index === -1).map((node) => node - 1)
}

/** Best order to visit the stops, computed in the browser. Exact for up to 10 stops. */
export function optimizeLocal(start: LatLng, stops: LatLng[], mode: EndMode): RouteResult {
  const dist = distanceMatrix(start, stops)
  const order = stops.length <= 10 ? solveExact(dist, mode) : solveHeuristic(dist, mode)
  return { order, distance: routeLength(order, dist, mode) }
}

/** Length of the route if the stops are visited in the given order (e.g. after manual changes). */
export function measure(start: LatLng, stops: LatLng[], order: number[], mode: EndMode): number {
  return routeLength(order, distanceMatrix(start, stops), mode)
}
