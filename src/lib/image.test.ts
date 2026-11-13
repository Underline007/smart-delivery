import { describe, expect, it } from 'vitest'
import { fitWithin } from './image'

describe('fitWithin', () => {
  it('shrinks the longer side to the limit, keeping the ratio', () => {
    expect(fitWithin(4000, 3000, 900)).toEqual({ width: 900, height: 675 })
    expect(fitWithin(3000, 4000, 900)).toEqual({ width: 675, height: 900 })
  })

  it('never enlarges a small image', () => {
    expect(fitWithin(400, 300, 900)).toEqual({ width: 400, height: 300 })
  })

  it('never returns a zero size', () => {
    expect(fitWithin(10000, 1, 900)).toEqual({ width: 900, height: 1 })
  })
})
