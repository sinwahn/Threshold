// scripts/common/p-map.ts
//
// Bounded-concurrency parallel map. Used by PublishPipeline to publish
// multiple packages in parallel without overwhelming the local registry.

export async function pMap<T, R>(
	items: readonly T[],
	concurrency: number,
	worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	if (items.length === 0) return []

	const results: R[] = new Array(items.length)
	let nextIndex = 0

	const runOne = async (): Promise<void> => {
		while (true) {
			const index = nextIndex++
			if (index >= items.length) return
			results[index] = await worker(items[index]!, index)
		}
	}

	const workerCount = Math.min(concurrency, items.length)
	const workers = Array.from({ length: workerCount }, () => runOne())
	await Promise.all(workers)
	return results
}
