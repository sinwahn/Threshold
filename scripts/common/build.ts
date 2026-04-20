// scripts/common/build.ts
import { execSync, type ExecSyncOptionsWithStringEncoding } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { config } from './config.js'
import { log } from './log.js'
import type { WorkspacePackage } from './workspace.js'

const { names } = config
const TRACKED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.json'])
const IGNORED_DIRS = new Set(['node_modules', names.dist, '.git', '.cache'])
const IGNORED_FILES = new Set<string>([names.buildInfo])


// -- Build stamp --

export interface BuildInfoData {
	patch: number
	build: number
	builtAt: number
}

export class BuildInfo implements BuildInfoData {
	private readonly path: string
	patch: number
	build: number
	builtAt: number

	constructor(packagePath: string) {
		this.path = join(packagePath, names.buildInfo)

		let data: Partial<BuildInfoData> = {}
		try {
			data = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<BuildInfoData>
		} catch { /* missing or corrupt -- start fresh */ }

		this.patch = typeof data.patch === 'number' ? data.patch : 0
		this.build = typeof data.build === 'number' ? data.build : 0
		this.builtAt = typeof data.builtAt === 'number' ? data.builtAt : 0
	}

	bumpBuild(): void {
		this.build++
		this.builtAt = Date.now()
	}

	promoteToPatch(): void {
		this.patch++
		this.build = 0
		this.builtAt = Date.now()
	}

	save(): void {
		const data: BuildInfoData = {
			patch: this.patch,
			build: this.build,
			builtAt: this.builtAt,
		}
		writeFileSync(this.path, JSON.stringify(data, null, '\t') + '\n', 'utf8')
	}
}


// -- Change detection --

function newestMtime(dir: string): number {
	let newest = 0
	try {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (IGNORED_DIRS.has(entry.name)) continue
			if (IGNORED_FILES.has(entry.name)) continue

			const full = join(dir, entry.name)
			if (entry.isDirectory()) {
				newest = Math.max(newest, newestMtime(full))
			} else {
				const dotIndex = entry.name.lastIndexOf('.')
				if (dotIndex < 0) continue
				const ext = entry.name.slice(dotIndex)
				if (TRACKED_EXTENSIONS.has(ext))
					newest = Math.max(newest, statSync(full).mtimeMs)
			}
		}
	} catch { /* unreadable */ }
	return newest
}

export function hasChanges(packagePath: string): boolean {
	if (!existsSync(join(packagePath, names.dist)))
		return true

	const info = new BuildInfo(packagePath)
	if (!info.builtAt)
		return true

	return newestMtime(packagePath) > info.builtAt
}


// -- Shell helpers --

interface ExecError extends Error {
	status?: number | null
	stdout?: string | Buffer
	stderr?: string | Buffer
}

function handleFail(error: unknown, actionName: string, name: string = '-'): never {
	console.error(`${actionName} failed for '${name}'`)
	const e = error as ExecError
	if (typeof e.stdout === 'string' && e.stdout.trim()) console.error(`stdout:\n${e.stdout.trim()}`)
	if (typeof e.stderr === 'string' && e.stderr.trim()) console.error(`stderr:\n${e.stderr.trim()}`)
	throw new Error(`${actionName} failed (exit ${e.status ?? '?'}): '${name}'`)
}

function runShell(command: string, actionName: string, pkgName: string = '-', cwd?: string): void {
	log(` $ ${command}`)
	const opts: ExecSyncOptionsWithStringEncoding = {
		stdio: 'pipe',
		encoding: 'utf8',
		...(cwd ? { cwd } : {}),
	}
	try {
		execSync(command, opts)
	} catch (error) {
		handleFail(error, actionName, pkgName)
	}
}


// -- Build steps --

function runEsmBuild(forceRebuild: boolean): void {
	const flag = forceRebuild ? ' --force' : ''
	runShell(`tsc --build ${names.tsconfigBuild}${flag}`, 'ESM build', '-', config.rootDir)
}

// -- Public API --

export function buildAll(packages: WorkspacePackage[], forceRebuild: boolean): void {
	runEsmBuild(forceRebuild)
	log('ESM build complete')
}

export function buildChanged(packages: WorkspacePackage[]): WorkspacePackage[] {
	const changed = packages.filter(p => hasChanges(p.path))

	if (changed.length === 0) {
		log('All packages up to date, skipping build')
		return changed
	}

	log(`Changed: ${changed.map(p => p.name).join(', ')}`)

	// ESM pass always runs the full `tsc --build` (composite/incremental
	// internally skips unchanged). CJS + buildInfo only for changed packages.
	runEsmBuild(false)
	log('ESM build complete')

	return changed
}