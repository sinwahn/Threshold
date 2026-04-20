// scripts/clean.ts
//
// Usage:
//   tsx --env-file=.env scripts/clean.ts [targets...]
//
// Targets (combine any):
//   dist       Remove dist/ and build info from every package
//   registry   Wipe Verdaccio data dir (storage + config + pid) + scrub global pnpm config
//   store      Run pnpm store prune + delete scoped metadata cache
//   modules    Remove all node_modules dirs and pnpm-lock.yaml
//   all        All of the above
//
// No arguments = dist (safe default)

import { execSync } from 'node:child_process'
import { existsSync, rmSync, readdirSync, Dirent } from 'node:fs'
import { join } from 'node:path'
import { config } from './common/config.js'
import { removePublishAuth, scrubGlobalPnpmConfig } from './common/registry.js'
import { log, warn, fail } from './common/log.js'

const { names } = config
const VALID_TARGETS = new Set(['dist', 'registry', 'store', 'modules'] as const)
type Target = typeof VALID_TARGETS extends Set<infer T> ? T : never

function parseTargets(): Set<Target> {
	const args = process.argv.slice(2).filter(a => !a.startsWith('-'))

	if (args.length === 0)
		return new Set < Target > (['dist'])

	if (args.includes('all'))
		return new Set(VALID_TARGETS)

	const targets = new Set < Target > ()
	for (const arg of args) {
		if (!VALID_TARGETS.has(arg as Target))
			throw new Error(`Unknown clean target: "${arg}". Valid: ${[...VALID_TARGETS].join(', ')}`)
		targets.add(arg as Target)
	}
	return targets
}

function removeIfExists(path: string, label: string): void {
	if (!existsSync(path)) return
	rmSync(path, { recursive: true, force: true })
	log(`Removed ${label}: ${path}`)
}

type packageCallback_t = (packageFolder: Dirent<string>, packagePath: string) => void

function forEachPackage(callback: packageCallback_t) {
	for (const entry of readdirSync(config.packagesDir, { withFileTypes: true })) {
		const packagePath = join(entry.parentPath, entry.name)
		if (entry.isDirectory())
			callback(entry, packagePath)
	}
}

function cleanDist(): void {
	log('--- Cleaning dist and build stamps ---')

	if (!existsSync(config.packagesDir)) {
		warn('No packages/ directory found')
		return
	}

	forEachPackage((entry, packagePath) => {
		removeIfExists(join(packagePath, names.dist), `${names.dist} (${entry.name})`)
		removeIfExists(join(packagePath, names.buildInfo), `build info (${entry.name})`)
		removeIfExists(join(packagePath, names.tsconfigTsBuildinfo), `ts build info (${entry.name})`)
	})
}

function cleanRegistry(): void {
	log('--- Cleaning Verdaccio data ---')
	// Wipe the whole verdaccio/ dir (storage + generated config + anything else).
	// Previously only storage was removed, leaving the config file orphaned.
	removeIfExists(config.verdaccioDir, 'verdaccio data dir')
	removePublishAuth()
	scrubGlobalPnpmConfig()
}

function cleanStore(): void {
	log('--- Cleaning pnpm store ---')

	try {
		execSync('pnpm store prune', { stdio: 'pipe' })
		log('pnpm store pruned')
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error)
		warn(`pnpm store prune failed: ${msg}`)
	}

	try {
		execSync(`pnpm cache delete "@${config.namespace}/*"`, { stdio: 'pipe' })
		log(`pnpm metadata cache deleted for @${config.namespace}/*`)
	} catch {
		warn('pnpm cache delete not available, skipping')
	}
}

function cleanModules(): void {
	log('--- Cleaning node_modules and lockfile ---')

	removeIfExists(join(config.rootDir, 'node_modules'), 'root node_modules')
	removeIfExists(config.lockfilePath, names.lockfile)
	removePublishAuth()

	if (!existsSync(config.packagesDir)) return

	for (const entry of readdirSync(config.packagesDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue
		removeIfExists(join(config.packagesDir, entry.name, 'node_modules'), `node_modules (${entry.name})`)
	}
}

function main(): void {
	const targets = parseTargets()
	log(`Clean targets: ${[...targets].join(', ')}`)

	if (targets.has('dist')) cleanDist()
	if (targets.has('registry')) cleanRegistry()
	if (targets.has('store')) cleanStore()
	if (targets.has('modules')) cleanModules()

	log('Clean complete')
}

try {
	main()
} catch (error) {
	fail(error)
	process.exit(1)
}