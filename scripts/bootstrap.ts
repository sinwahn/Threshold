// scripts/bootstrap.ts
//
// Modes (mutually exclusive):
//   (default)        build incremental + publish changed + exit
//   --force-rebuild  rebuild all + publish all + exit
//   --serve          build incremental + publish changed + keep registry alive
//
// Independent flags:
//   --export-api                 also write API exports to outputDir/api/
//   --skip-registry-operations   skip everything except --export-api

import { Registry, RegistryClient, type RegistryHandle } from './common/registry.js'
import { Workspace, type Package } from './common/workspace.js'
import { PublishPipeline } from './common/publish.js'
import { build } from './common/build.js'
import { exportApi } from './common/api-export.js'
import { log, warn, exitWithError } from './common/log.js'

const args = process.argv.slice(2)
const MODE_SERVE = args.includes('--serve')
const MODE_FORCE_REBUILD = args.includes('--force-rebuild')
const EXPORT_API = args.includes('--export-api')
const SKIP_REGISTRY_OPERATIONS = args.includes('--skip-registry-operations')

async function main(): Promise<void> {
	if (SKIP_REGISTRY_OPERATIONS) {
		if (EXPORT_API) exportApi()
		return
	}

	const client = new RegistryClient()
	const registry = new Registry(client)
	const handle = await registry.ensureRunning()

	installSignalHandlers(registry, handle)

	try {
		const targets = Workspace.discover()
		log(`Found ${targets.length} workspace package(s): ${targets.map(target => target.name).join(', ')}`)

		// tsc --build is incremental on its own (composite + tsbuildinfo).
		// --force only matters when MODE_FORCE_REBUILD is set.
		build(MODE_FORCE_REBUILD)

		const toPublish = MODE_FORCE_REBUILD ? targets : targets.filter(target => target.hasChanges())
		if (toPublish.length > 0) {
			log(`Publishing: ${toPublish.map(target => target.name).join(', ')}`)
			const pipeline = new PublishPipeline(client)
			await pipeline.run(toPublish)
		} else {
			log('No packages need publishing')
		}

		if (EXPORT_API) exportApi()

		if (MODE_SERVE) {
			log('Registry staying alive (Ctrl+C to stop)')
			await new Promise<never>(() => { /* never resolves -- signal handlers exit */ })
		}
		
		log(handle.reused ? 'Done, left existing registry running' : 'Done, shut down registry')
		await registry.shutdown(handle)
	}
	catch (error) {
		exitWithError(error)
	}

}

function installSignalHandlers(registry: Registry, handle: RegistryHandle): void {
	const onSignal = (name: string, exitCode: number): void => {
		warn(`${name} received`)
		void registry.shutdown(handle).then(() => process.exit(exitCode))
	}
	process.on('SIGINT', () => onSignal('SIGINT', 130))
	process.on('SIGTERM', () => onSignal('SIGTERM', 143))
}

await main()
