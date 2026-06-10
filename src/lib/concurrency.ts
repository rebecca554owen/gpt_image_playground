export async function runLimitedSettled<TItem, TResult>(
  items: TItem[],
  limit: number,
  worker: (item: TItem, index: number) => Promise<TResult>,
): Promise<PromiseSettledResult<TResult>[]> {
  const results: PromiseSettledResult<TResult>[] = new Array(items.length)
  const workerCount = Math.max(1, Math.min(Math.floor(limit), items.length))
  let nextIndex = 0

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++
      try {
        results[index] = {
          status: 'fulfilled',
          value: await worker(items[index], index),
        }
      } catch (reason) {
        results[index] = {
          status: 'rejected',
          reason,
        }
      }
    }
  }))

  return results
}
