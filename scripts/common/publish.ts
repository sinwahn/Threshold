// scripts/common/publish.ts
import { execSync, type ExecSyncOptionsWithStringEncoding } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { config } from './config.js'
import { BuildInfo } from './build.js'
import { log } from './log.js'
import type { WorkspacePackage } from './workspace.js'


// -- Version resolution --

async function fetchLatestVersion(name: string): Promise<string | null> {
	const url = `${config.registryUrl}/${encodeURIComponent(name)}`
	try {
		const response = await fetch(url, { signal: AbortSignal.timeout(5_000) })
		if (!response.ok) return null

		const data = await response.json() as { 'dist-tags'?: { latest?: string } }
		return data['dist-tags']?.latest ?? null
	} catch {
		return null
	}
}

function compareVersions(a: string, b: string): number {
	const pa = a.split('.').map(Number)
	const pb = b.split('.').map(Number)

	for (let i = 0; i < 3; i++) {
		const av = pa[i] ?? 0
		const bv = pb[i] ?? 0
		if (av < bv) return -1
		if (av > bv) return 1
	}
	return 0
}

async function resolveVersion(name: string, currentVersion: string, buildInfo: BuildInfo): Promise<string> {
	const registryVersion = await fetchLatestVersion(name)

	let baseVersion: string
	if (!registryVersion) {
		log(` ${name}: nothing in registry, using ${currentVersion}`)
		baseVersion = currentVersion
	} else if (compareVersions(currentVersion, registryVersion) > 0) {
		log(` ${name}: current ${currentVersion} > registry ${registryVersion}, using current`)
		baseVersion = currentVersion
	} else {
		baseVersion = registryVersion
		log(` ${name}: registry has ${registryVersion}, using as base`)
	}

	const cleanBase = baseVersion.replace(/-.*$/, '')
	return `${cleanBase}-build.${buildInfo.build}`
}


// -- package.json version read/write --

interface PackageJsonShape {
	version?: string
	[key: string]: unknown
}

function readPackageVersion(packagePath: string): string {
	const raw = JSON.parse(readFileSync(join(packagePath, 'package.json'), 'utf8')) as PackageJsonShape
	if (!raw.version) throw new Error(`Missing version in ${packagePath}/package.json`)
	return raw.version
}

function writePackageVersion(packagePath: string, version: string): void {
	const filePath = join(packagePath, 'package.json')
	const raw = JSON.parse(readFileSync(filePath, 'utf8')) as PackageJsonShape
	raw.version = version
	writeFileSync(filePath, JSON.stringify(raw, null, '\t') + '\n', 'utf8')
}


// -- Shell helpers (narrower duplicate of build.js's -- keeps modules decoupled) --

interface ExecError extends Error {
	status?: number | null
	stdout?: string | Buffer
	stderr?: string | Buffer
}

function handleFail(error: unknown, actionName: string, name: string): never {
	console.error(`${actionName} failed for '${name}'`)
	const e = error as ExecError
	if (typeof e.stdout === 'string' && e.stdout.trim()) console.error(`stdout:\n${e.stdout.trim()}`)
	if (typeof e.stderr === 'string' && e.stderr.trim()) console.error(`stderr:\n${e.stderr.trim()}`)
	throw new Error(`${actionName} failed (exit ${e.status ?? '?'}): '${name}'`)
}

function runPublish(name: string): void {
	const command = `pnpm --filter ${name} publish --registry ${config.registryUrl} --no-git-checks`
	log(` $ ${command}`)
	const opts: ExecSyncOptionsWithStringEncoding = { stdio: 'pipe', encoding: 'utf8' }
	try {
		execSync(command, opts)
	} catch (error) {
		handleFail(error, 'Publish', name)
	}
}

async function verifyPublished(name: string, version: string): Promise<void> {
	const url = `${config.registryUrl}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`
	try {
		const response = await fetch(url, { signal: AbortSignal.timeout(5_000) })
		if (!response.ok)
			throw new Error(`HTTP ${response.status}`)

		const data = await response.json() as { name?: string, version?: string }
		if (data.name !== name || data.version !== version)
			throw new Error(`Response mismatch: got ${data.name}@${data.version}`)

		log(` Verified ${name}@${version}`)
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error)
		throw new Error(`Verification failed for ${name}@${version}: ${msg}`)
	}
}


// -- Public API --

export async function publishPackages(packages: WorkspacePackage[]): Promise<void> {
	let published = 0

	for (const pkg of packages) {
		const info = new BuildInfo(pkg.path)
		const currentVersion = readPackageVersion(pkg.path)
		const targetVersion = await resolveVersion(pkg.name, currentVersion, info)

		if (targetVersion !== currentVersion) {
			writePackageVersion(pkg.path, targetVersion)
			log(` ${pkg.name}: version ${currentVersion} -> ${targetVersion}`)
		}

		runPublish(pkg.name)
		await verifyPublished(pkg.name, targetVersion)
		published++
	}

	log(`Published ${published} package(s)`)
}