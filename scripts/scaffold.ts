// scripts/scaffold.ts
//
// Usage:
//   tsx --env-file=.env scripts/scaffold.ts <name> [--version 0.1.0] [--dep core] [--dep other]
//   tsx --env-file=.env scripts/scaffold.ts --regenerate

import { parseArgs } from 'node:util'
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { config } from './common/config.js'
import { packageJson, tsconfigPackage, indexTs } from './common/templates.js'
import { log, warn, exitWithError } from './common/log.js'


// -- Args --

interface CreateArgs {
	mode: 'create'
	name: string
	version: string
	dependencies: string[]
}

interface RegenArgs {
	mode: 'regenerate'
}

type ParsedArgs = CreateArgs | RegenArgs

function parse(): ParsedArgs {
	const { values, positionals } = parseArgs({
		args: process.argv.slice(2),
		allowPositionals: true,
		options: {
			regenerate: { type: 'boolean', default: false },
			version: { type: 'string', default: '0.1.0' },
			dep: { type: 'string', multiple: true, default: [] },
		},
	})

	if (values.regenerate)
		return { mode: 'regenerate' }

	const name = positionals[0]
	if (!name)
		throw new Error('Usage: scaffold.ts <name> [--version 0.1.0] [--dep core] [--dep other]')

	return {
		mode: 'create',
		name,
		version: values.version ?? '0.1.0',
		dependencies: values.dep ?? [],
	}
}


// -- tsconfig.build.json reference registration --
//
// NOTE: this uses JSON.parse, so tsconfig.build.json must NOT contain comments.
// Comments are valid in tsconfig by convention (JSONC), but root solution-style
// configs rarely need them. If you add comments, this automation will refuse
// rather than silently strip them.

interface TsconfigBuildShape {
	files?: unknown[]
	references?: Array<{ path: string }>
	[key: string]: unknown
}

function registerPackageReference(pkgName: string): void {
	const filePath = config.tsconfigBuildPath

	if (!existsSync(filePath)) {
		warn(`${filePath} not found; skipping reference registration`)
		return
	}

	const tsconfig = JSON.parse(readFileSync(filePath, 'utf8')) as TsconfigBuildShape

	tsconfig.references ??= []
	const desiredPath = `${config.names.packages}/${pkgName}`
	if (tsconfig.references.some(r => r.path === desiredPath)) {
		log(`Reference already present for ${pkgName}`)
		return
	}

	tsconfig.references.push({ path: desiredPath })
	writeFileSync(filePath, JSON.stringify(tsconfig, null, '\t') + '\n', 'utf8')
	log(`Registered ${pkgName} in ${config.names.tsconfigBuild}`)
}


// -- Package config writing --

function writePackageConfig(pkgDir: string, name: string, version: string, depNames: string[]): void {
	writeFileSync(
		join(pkgDir, 'package.json'),
		packageJson({ namespace: config.namespace, name, version, dependencies: depNames }) + '\n',
		'utf8',
	)

	writeFileSync(
		join(pkgDir, 'tsconfig.json'),
		tsconfigPackage({ references: depNames }) + '\n',
		'utf8',
	)

	log(`Wrote configs for ${name}`)
}

function createPackage(name: string, version: string, depNames: string[]): void {
	const pkgDir = join(config.packagesDir, name)

	if (existsSync(pkgDir))
		throw new Error(`Package directory already exists: ${pkgDir}`)

	mkdirSync(join(pkgDir, config.names.src), { recursive: true })
	writePackageConfig(pkgDir, name, version, depNames)

	writeFileSync(join(pkgDir, config.names.src, 'index.ts'), indexTs(), 'utf8')
	log(`Created package scaffold at ${config.names.packages}/${name}/`)

	registerPackageReference(name)
}

function regenerateAll(): void {
	if (!existsSync(config.packagesDir))
		throw new Error(`No packages/ directory found at ${config.packagesDir}`)

	const scopePrefix = `@${config.namespace}/`

	for (const entry of readdirSync(config.packagesDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue

		const pkgDir = join(config.packagesDir, entry.name)
		const pkgJsonPath = join(pkgDir, 'package.json')

		if (!existsSync(pkgJsonPath)) {
			warn(`Skipping ${entry.name}: no package.json`)
			continue
		}

		const existing = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as {
			version?: string
			dependencies?: Record<string, string>
		}

		const version = existing.version ?? '0.1.0'
		const depNames = Object.keys(existing.dependencies ?? {})
			.filter(d => d.startsWith(scopePrefix))
			.map(d => d.slice(scopePrefix.length))

		writePackageConfig(pkgDir, entry.name, version, depNames)
	}

	log('Regenerated all package configs')
}

function main(): void {
	const parsed = parse()
	if (parsed.mode === 'regenerate') regenerateAll()
	else createPackage(parsed.name, parsed.version, parsed.dependencies)
}

try {
	main()
} catch (error) {
	exitWithError(error)
}
