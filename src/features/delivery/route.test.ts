import { describe, expect, it } from 'vitest'
import type { LatLng } from '@/lib/maps/link'
import {
  distanceMatrix,
  estimateRoad,
  measure,
  optimizeLocal,
  routeLength,
  solveExact,
  solveHeuristic,
  type EndMode,
} from './route'

/** Small deterministic random generator so the tests never flake. */
function rng(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

function randomPoints(count: number, seed: number): LatLng[] {
  const next = rng(seed)
  return Array.from({ length: count }, () => ({ lat: 10.7 + next() * 0.15, lng: 106.6 + next() * 0.15 }))
}

function permutations(n: number): number[][] {
  if (n === 0) return [[]]
  const result: number[][] = []
  const recurse = (current: number[], rest: number[]) => {
    if (rest.length === 0) result.push(current)
    for (let i = 0; i < rest.length; i++) recurse([...current, rest[i]], rest.filter((_, j) => j !== i))
  }
  recurse([], Array.from({ length: n }, (_, i) => i))
  return result
}

function bruteForce(start: LatLng, stops: LatLng[], mode: EndMode): number {
  const dist = distanceMatrix(start, stops)
  return Math.min(...permutations(stops.length).map((p) => routeLength(p, dist, mode)))
}

const start: LatLng = { lat: 10.78, lng: 106.69 }

describe('optimizeLocal', () => {
  it.each([1, 2, 3, 4, 5, 6, 7])('is exactly optimal for %i stops, both modes', (count) => {
    for (const seed of [1, 2, 3]) {
      const stops = randomPoints(count, seed * 31 + count)
      for (const mode of ['return', 'last'] as const) {
        const result = optimizeLocal(start, stops, mode)
        expect(result.order).toHaveLength(count)
        expect([...result.order].sort()).toEqual(Array.from({ length: count }, (_, i) => i))
        expect(result.distance).toBeCloseTo(bruteForce(start, stops, mode), 3)
      }
    }
  })

  it('handles no stops and one stop', () => {
    expect(optimizeLocal(start, [], 'return')).toEqual({ order: [], distance: 0 })
    const one = optimizeLocal(start, [{ lat: 10.8, lng: 106.7 }], 'return')
    expect(one.order).toEqual([0])
    expect(one.distance).toBeGreaterThan(0)
  })

  it('visits points on a line in order of distance', () => {
    const stops = [0.05, 0.01, 0.03, 0.02, 0.04].map((d) => ({ lat: 10.78, lng: 106.69 + d }))
    expect(optimizeLocal(start, stops, 'last').order).toEqual([1, 3, 2, 4, 0])
  })

  it('a round trip is never shorter than an open path to the same stops', () => {
    const stops = randomPoints(6, 7)
    expect(optimizeLocal(start, stops, 'return').distance).toBeGreaterThanOrEqual(optimizeLocal(start, stops, 'last').distance)
  })

  it('does not take unreasonably long for 10 stops', () => {
    const t = Date.now()
    optimizeLocal(start, randomPoints(10, 99), 'return')
    expect(Date.now() - t).toBeLessThan(2000)
  })
})

describe('solveHeuristic', () => {
  it('returns a valid permutation and stays close to optimal', () => {
    let ratioSum = 0
    let worst = 0
    const runs = 20
    for (let seed = 1; seed <= runs; seed++) {
      const stops = randomPoints(9, seed * 13)
      const dist = distanceMatrix(start, stops)
      for (const mode of ['return', 'last'] as const) {
        const order = solveHeuristic(dist, mode)
        expect([...order].sort()).toEqual(Array.from({ length: 9 }, (_, i) => i))
        const ratio = routeLength(order, dist, mode) / routeLength(solveExact(dist, mode), dist, mode)
        ratioSum += ratio
        worst = Math.max(worst, ratio)
      }
    }
    expect(ratioSum / (runs * 2)).toBeLessThan(1.1)
    expect(worst).toBeLessThan(1.35)
  })

  it('is used above 10 stops and returns every stop once', () => {
    const stops = randomPoints(30, 5)
    const result = optimizeLocal(start, stops, 'return')
    expect([...result.order].sort((a, b) => a - b)).toEqual(Array.from({ length: 30 }, (_, i) => i))
  })

  it('is clearly better than the order the stops were given in', () => {
    const stops = randomPoints(30, 11)
    const given = measure(start, stops, stops.map((_, i) => i), 'return')
    expect(optimizeLocal(start, stops, 'return').distance).toBeLessThan(given * 0.6)
  })
})

describe('estimateRoad', () => {
  it('adds a detour factor and converts to time', () => {
    const { distance_m, duration_s } = estimateRoad(10_000)
    expect(distance_m).toBe(13_000)
    expect(duration_s).toBe(Math.round((13 / 25) * 3600))
  })
})
