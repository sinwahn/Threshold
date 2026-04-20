// scripts/bootstrap.ts
//
// Modes (mutually exclusive):
//   (default)        build changed + publish changed + exit
//   --force-rebuild  rebuild all + publish all + exit
//   --serve          build changed + keep registry alive (no publish, no exit)

import { ensureRunning, shutdown } from './common/registry.js'
import { discoverPackages, type WorkspacePackage } from './common/workspace.js'
import { buildAll, buildChanged } from './common/build.js'
import { publishPackages } from './common/publish.js'
import { log, warn, fail } from './common/log.js'

const args = process.argv.slice(2)
const MODE_SERVE = args.includes('--serve')
const MODE_FORCE_REBUILD = args.includes('--force-rebuild')

async function main(): Promise<void> {
	const handle = await ensureRunning()

	// Signal handlers: cleanup then exit. Async-safe: we `void` the promise
	// and schedule process.exit in .then() so the exit code is deterministic.
	const handleSignal = (name: string, exitCode: number): void => {
		warn(`${name} received`)
		void shutdown(handle).then(() => process.exit(exitCode))
	}
	process.on('SIGINT', () => handleSignal('SIGINT', 130))
	process.on('SIGTERM', () => handleSignal('SIGTERM', 143))

	try {
		const packages = discoverPackages()
		log(`Found ${packages.length} workspace package(s): ${packages.map(p => p.name).join(', ')}`)

		let toPublish: WorkspacePackage[]
		if (MODE_FORCE_REBUILD) {
			buildAll(packages, true)
			toPublish = packages
		} else {
			toPublish = buildChanged(packages)
		}

		if (toPublish.length > 0)
			await publishPackages(toPublish)

		if (MODE_SERVE) {
			log('Registry staying alive (Ctrl+C to stop)')
			await new Promise<never>(() => { /* never resolves -- signal handlers exit */ })
		}
	} finally {
		await shutdown(handle)
	}

	log(handle.reused ? 'Done, left existing registry running' : 'Done, shut down registry')
}

main().catch((error: unknown) => {
	fail('Bootstrap failed:', error)
	process.exit(1)
})