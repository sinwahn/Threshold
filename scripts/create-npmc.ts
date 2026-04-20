// scripts/create-npmc.ts
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { config } from './common/config.js'
import { npmrc } from './common/templates.js'
import { log, fail } from './common/log.js'

function main(): void {
	mkdirSync(config.outputDir, { recursive: true })

	const outputPath = resolve(config.outputDir, config.names.publishNpmrc)
	const content = npmrc({
		namespace: config.namespace,
		registryUrl: config.registryUrl,
		registryHost: config.registryHost,
		authToken: config.authToken,
	})

	writeFileSync(outputPath, content, 'utf8')
	log(`Written: ${outputPath}`)
}

try {
	main()
} catch (error) {
	fail(error)
	process.exit(1)
}