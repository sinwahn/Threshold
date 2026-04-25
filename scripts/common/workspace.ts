// scripts/common/workspace.ts
//
// Package: workspace member as state + behavior. Loads its publish-stamp
// data at construction; updates package.json and the stamp on publish.
// No separate PublishStamp class: stamp data is part of the package's
// identity, not an external object.
//
// Workspace.discover reads packages/ directly. The previous design called
// `pnpm -r ls --json` which adds ~500ms cold start for information already
// on disk.

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, type Dirent } from 'node:fs'
import { join, extname } from 'node:path'
import { config } from './config.js'

const TRACKED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json'])
const IGNORED_DIRS = new Set(['node_modules', config.names.dist, '.git', '.cache'])
const IGNORED_FILES = new Set([config.names.trBuildInfo, config.names.tsBuildInfo])

interface PackageJsonShape {
	name: string
	version: string
	private?: boolean
}

class BuildInfo
{
	publishedAt: number = 0
	buildNumber: number = 0
	version: string = ''

	constructor() {

	}

	loadFromFile(filePath: string) {
		const data = JSON.parse(readFileSync(filePath, 'utf8'))
		this.publishedAt = data.publishedAt
		this.buildNumber = data.buildNumber
		this.version = data.version
	}

	writeToFile(filePath: string): void {
		const data = {
			version: this.version,
			buildNumber: this.buildNumber,
			publishedAt: this.publishedAt,
		}
		writeFileSync(filePath, JSON.stringify(data, null, '\t') + '\n', 'utf8')
	}
}

export class Package {
	readonly name: string
	readonly path: string

	private buildInfo = new BuildInfo()

	constructor(name: string, version: string, path: string) {
		this.name = name
		this.path = path
		this.tryLoadBuildInfo()
		this.buildInfo.version = version
	}

	getCurrentVersion(): string {
		return this.buildInfo.version
	}

	getNextBuildNumber(): number {
		return this.buildInfo.buildNumber + 1
	}

	hasChanges(): boolean {
		if (this.buildInfo.publishedAt === 0)
			return true
		return walkNewest(this.path) > this.buildInfo.publishedAt
	}

	writeVersion(newVersion: string): void {
		const filePath = join(this.path, 'package.json')
		const raw = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>
		raw.version = newVersion
		writeFileSync(filePath, JSON.stringify(raw, null, '\t') + '\n', 'utf8')
		this.buildInfo.version = newVersion
	}

	markPublished(): void {
		this.buildInfo.buildNumber++
		this.buildInfo.publishedAt = Date.now()
		this.writeBuildInfo()
	}

	private tryLoadBuildInfo(): void {
		const filePath = join(this.path, config.names.trBuildInfo)
		if (existsSync(filePath))
			this.buildInfo.loadFromFile(filePath)
	}

	private writeBuildInfo(): void {
		const filePath = join(this.path, config.names.trBuildInfo)
		this.buildInfo.writeToFile(filePath)
	}
}


// -- Source-mtime walk --
//
// Recurses the package directory once per hasChanges() call, finding the
// most recently modified tracked source file. Compared against the stamp's
// publishedAt to decide whether a republish is needed.

function walkNewest(dir: string): number {
	let newest = 0
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (IGNORED_DIRS.has(entry.name)) continue
		if (IGNORED_FILES.has(entry.name)) continue

		const full = join(dir, entry.name)
		if (entry.isDirectory()) {
			newest = Math.max(newest, walkNewest(full))
			continue
		}

		if (TRACKED_EXTENSIONS.has(extname(entry.name)))
			newest = Math.max(newest, statSync(full).mtimeMs)
	}
	return newest
}


// -- Discovery --

export class Workspace {
	static discover(): Package[] {
		if (!existsSync(config.packagesDir))
			throw new Error(`No packages/ directory at ${config.packagesDir}`)

		const result: Package[] = []
		for (const entry of readdirSync(config.packagesDir, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue
			const target = readPackage(entry, join(config.packagesDir, entry.name))
			if (target) result.push(target)
		}
		return result
	}
}

function readPackage(entry: Dirent, memberPath: string): Package | null {
	const pkgJsonPath = join(memberPath, 'package.json')
	if (!existsSync(pkgJsonPath)) return null

	const data = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as PackageJsonShape
	if (data.private) return null

	return new Package(data.name, data.version, memberPath)
}
