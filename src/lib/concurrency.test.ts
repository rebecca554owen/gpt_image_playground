import { describe, expect, it } from 'vitest'
import { runLimitedSettled } from './concurrency'

describe('runLimitedSettled', () => {
  it('preserves result order while capping active workers', async () => {
    let active = 0
    let maxActive = 0

    const results = await runLimitedSettled([1, 2, 3, 4], 2, async (item) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 0))
      active -= 1
      if (item === 3) throw new Error('boom')
      return item * 2
    })

    expect(maxActive).toBe(2)
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled', 'rejected', 'fulfilled'])
    expect(results[0]).toMatchObject({ status: 'fulfilled', value: 2 })
    expect(results[1]).toMatchObject({ status: 'fulfilled', value: 4 })
    expect(results[3]).toMatchObject({ status: 'fulfilled', value: 8 })
  })
})
