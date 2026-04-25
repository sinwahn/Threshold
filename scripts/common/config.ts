// scripts/common/config.ts
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const COMMON_DIR = dirname(fileURLToPath(import.meta.url))
const SCRIPTS_DIR = resolve(COMMON_DIR, '..')
const ROOT_DIR = resolve(SCRIPTS_DIR, '..')

function requireEnv(name: string): string {
	const value = process.env[name]
	if (!value)
		throw new Error(`Missing required env var: ${name}`)
	return value
}

function optionalEnv(name: string, fallback: string): string {
	return process.env[name] ?? fallback
}

const port = requireEnv('VERDACCIO_PORT')
const namespace = requireEnv('NPM_NAMESPACE')
const authToken = requireEnv('VERDACCIO_AUTH_TOKEN')
const outputSubdir = optionalEnv('SCRIPT_OUTPUT_DIR', 'out')

// 'localhost' may resolve to ::1 on Node >=17 (IPv6 first), but Verdaccio
// historically binds IPv4-only. Each fetch then waits for the IPv6 attempt
// to time out before falling back -- compounds across many publish/verify
// fetches. Using 127.0.0.1 explicitly skips DNS entirely.
const registryHostname = '127.0.0.1'
const registryHost = `${registryHostname}:${port}`
const registryUrl = `http://${registryHost}`

// Every segment that appears in a path or filename lives here.
// Renaming a folder or file = changing one line.
const names = Object.freeze({
	data: 'data',
	verdaccio: 'verdaccio',
	storage: 'storage',
	packages: 'packages',
	scripts: 'scripts',
	dist: 'dist',
	src: 'src',
	verdaccioConfig: 'verdaccio-config.yaml',
	trBuildInfo: 'trbuildinfo.json',
	publishNpmrc: '.npmrc',
	lockfile: 'pnpm-lock.yaml',
	tsconfigBuild: 'tsconfig.build.json',
	tsBuildInfo: 'tsconfig.tsbuildinfo',
})

const dataDir = resolve(ROOT_DIR, names.data)
const verdaccioDir = resolve(dataDir, names.verdaccio)

export const config = Object.freeze({
	namespace,
	authToken,
	port,
	registryHostname,
	registryHost,
	registryUrl,
	pingUrl: `${registryUrl}/-/ping`,

	names,

	rootDir: ROOT_DIR,
	scriptsDir: SCRIPTS_DIR,
	packagesDir: resolve(ROOT_DIR, names.packages),
	outputDir: resolve(ROOT_DIR, outputSubdir),

	lockfilePath: resolve(ROOT_DIR, names.lockfile),
	tsconfigBuildPath: resolve(ROOT_DIR, names.tsconfigBuild),

	dataDir,
	verdaccioDir,
	storageDir: resolve(verdaccioDir, names.storage),
	verdaccioConfigPath: resolve(verdaccioDir, names.verdaccioConfig),

	publishConcurrency: 8,
	pingTimeoutMs: 30_000,
	pingIntervalMs: 100,
	killTimeoutMs: 3_000,
	fetchTimeoutMs: 60_000,
})

export type Config = typeof config
