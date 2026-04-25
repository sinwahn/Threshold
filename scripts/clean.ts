// scripts/clean.ts
//
// Usage:
//   tsx --env-file=.env scripts/clean.ts [targets...]
//
// Targets (combine any):
//   dist       Remove dist/ and publish stamps from every package
//   registry   Wipe Verdaccio data dir (storage + generated config)
//   store      Run pnpm store prune + delete scoped metadata cache
//   modules    Remove all node_modules dirs and pnpm-lock.yaml
//   all        All of the above
//
// No arguments = dist (safe default)

import { execSync } from 'node:child_process'
import { existsSync, rmSync, readdirSync, type Dirent } from 'node:fs'
import { join } from 'node:path'
import { config } from './common/config.js'
import { log, warn, exitWithError } from './common/log.js'

const { names } = config
const VALID_TARGETS = new Set(['dist', 'registry', 'store', 'modules'] as const)
type Target = typeof VALID_TARGETS extends Set<infer T> ? T : never

function parseTargets(): Set<Target> {
	const args = process.argv.slice(2).filter(a => !a.startsWith('-'))

	if (args.length === 0)
		return new Set<Target>(['dist'])

	if (args.includes('all'))
		return new Set(VALID_TARGETS)

	const selected = new Set<Target>()
	for (const arg of args) {
		if (!VALID_TARGETS.has(arg as Target))
			throw new Error(`Unknown clean target: "${arg}". Valid: ${[...VALID_TARGETS, 'all'].join(', ')}`)
		selected.add(arg as Target)
	}
	return selected
}

function removeIfExists(path: string, label: string): void {
	if (!existsSync(path)) return
	rmSync(path, { recursive: true, force: true })
	log(`Removed ${label}: ${path}`)
}

function forEachPackage(callback: (entry: Dirent, packagePath: string) => void): void {
	if (!existsSync(config.packagesDir)) return
	for (const entry of readdirSync(config.packagesDir, { withFileTypes: true })) {
		if (entry.isDirectory())
			callback(entry, join(config.packagesDir, entry.name))
	}
}

function cleanDist(): void {
	log('--- Cleaning dist and publish stamps ---')
	forEachPackage((entry, packagePath) => {
		removeIfExists(join(packagePath, names.dist), `${names.dist} (${entry.name})`)
		removeIfExists(join(packagePath, names.trBuildInfo), `publish stamp (${entry.name})`)
		removeIfExists(join(packagePath, names.tsBuildInfo), `ts build info (${entry.name})`)
	})
}

function cleanRegistry(): void {
	log('--- Cleaning Verdaccio data ---')
	// Wipe the whole verdaccio/ dir (storage + generated config + anything else).
	// Previously only storage was removed, leaving the config file orphaned.
	removeIfExists(config.verdaccioDir, 'verdaccio data dir')
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

	forEachPackage((entry, packagePath) => {
		removeIfExists(join(packagePath, 'node_modules'), `node_modules (${entry.name})`)
	})
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
	exitWithError(error)
}
