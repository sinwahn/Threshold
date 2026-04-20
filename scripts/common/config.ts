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

const registryHost = `localhost:${port}`
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
	distEsm: 'dist/esm',
	src: 'src',
	verdaccioConfig: 'verdaccio-config.yaml',
	buildInfo: '.build-info.json',
	publishNpmrc: '.npmrc',
	lockfile: 'pnpm-lock.yaml',
	tsconfigBuild: 'tsconfig.build.json',
	tsconfigTsBuildinfo: 'tsconfig.tsbuildinfo'
})

const dataDir = resolve(ROOT_DIR, names.data)
const verdaccioDir = resolve(dataDir, names.verdaccio)

export const config = Object.freeze({
	namespace,
	authToken,
	port,

	registryHost,
	registryUrl,
	pingUrl: `${registryUrl}/-/ping`,

	names,

	rootDir: ROOT_DIR,
	scriptsDir: SCRIPTS_DIR,
	packagesDir: resolve(ROOT_DIR, names.packages),
	outputDir: resolve(ROOT_DIR, outputSubdir),

	publishNpmrcPath: resolve(ROOT_DIR, names.publishNpmrc),
	lockfilePath: resolve(ROOT_DIR, names.lockfile),
	tsconfigBuildPath: resolve(ROOT_DIR, names.tsconfigBuild),

	dataDir,
	verdaccioDir,
	storageDir: resolve(verdaccioDir, names.storage),
	verdaccioConfigPath: resolve(verdaccioDir, names.verdaccioConfig),

	pingTimeoutMs: 30_000,
	pingIntervalMs: 500,
	killTimeoutMs: 3_000,
})

export type Config = typeof config