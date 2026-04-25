// scripts/create-npmrc.ts
//
// Writes a sample .npmrc to outputDir/.npmrc that downstream consumers can
// drop into their own project to pull from this Verdaccio. This is purely
// an opt-in helper; the bootstrap pipeline never writes any .npmrc anywhere
// on the user's filesystem.

import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { config } from './common/config.js'
import { npmrc } from './common/templates.js'
import { log, exitWithError } from './common/log.js'

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
	exitWithError(error)
}
