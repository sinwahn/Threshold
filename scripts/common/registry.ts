// scripts/common/registry.ts
import { spawn, execSync, type ChildProcess } from 'node:child_process'
import { existsSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { config } from './config.js'
import { verdaccioYaml } from './templates.js'
import { log, warn, fail } from './log.js'

const require = createRequire(import.meta.url)

export interface RegistryHandle {
	process: ChildProcess | null
	reused: boolean
}

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms))
}

// -- Verdaccio config generation --

function generateConfig(): void {
	mkdirSync(config.verdaccioDir, { recursive: true })

	const yaml = verdaccioYaml({
		storageDir: config.storageDir,
		namespace: config.namespace,
		port: config.port,
	})

	writeFileSync(config.verdaccioConfigPath, yaml, 'utf8')
	log(`Generated verdaccio config at ${config.verdaccioConfigPath}`)
}


// -- Publish auth --
// Ephemeral .npmrc at monorepo root. Written before publish, deleted after.
// Contains ONLY the auth token line so pnpm install never reaches Verdaccio.
// Publish commands pass --registry explicitly.
//
// Single-user workflow assumption: concurrent bootstrap invocations will race
// on this file. Acceptable for local dev; document as a known limitation.

export function writePublishAuth(): void {
	const content = `//${config.registryHost}/:_authToken=${config.authToken}\n`
	writeFileSync(config.publishNpmrcPath, content, 'utf8')
	log(`Wrote publish auth to ${config.publishNpmrcPath}`)
}

export function removePublishAuth(): void {
	if (existsSync(config.publishNpmrcPath)) {
		unlinkSync(config.publishNpmrcPath)
		log(`Removed ${config.publishNpmrcPath}`)
	}
}

export function scrubGlobalPnpmConfig(): void {
	try {
		execSync(`pnpm config delete //${config.registryHost}/:_authToken`, { stdio: 'pipe' })
		log('Removed auth token from global pnpm config')
	} catch { /* not present */ }

	try {
		execSync(`pnpm config delete @${config.namespace}:registry`, { stdio: 'pipe' })
		log('Removed scoped registry from global pnpm config')
	} catch { /* not present */ }
}


// -- Lifecycle --

async function ping(): Promise<boolean> {
	try {
		const response = await fetch(config.pingUrl, { signal: AbortSignal.timeout(1_500) })
		return response.ok
	} catch {
		return false
	}
}

async function waitUntilReady(): Promise<void> {
	const deadline = Date.now() + config.pingTimeoutMs
	let attempts = 0

	while (Date.now() < deadline) {
		attempts++
		if (await ping()) {
			log(`Registry responded after ${attempts} attempt(s)`)
			return
		}
		log(`Attempt ${attempts}: not ready, retrying in ${config.pingIntervalMs}ms`)
		await sleep(config.pingIntervalMs)
	}

	throw new Error(`Registry did not respond within ${config.pingTimeoutMs}ms`)
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
	return new Promise(resolve => {
		if (child.exitCode !== null || child.signalCode !== null) {
			resolve()
			return
		}

		const timer = setTimeout(() => {
			warn(`Verdaccio did not exit within ${timeoutMs}ms, sending SIGKILL`)
			if (!child.killed) child.kill('SIGKILL')
			resolve()
		}, timeoutMs)

		child.once('exit', () => {
			clearTimeout(timer)
			resolve()
		})
	})
}

export async function ensureRunning(): Promise<RegistryHandle> {
	if (await ping()) {
		log('Registry already running, reusing')
		writePublishAuth()
		return { process: null, reused: true }
	}

	generateConfig()

	const verdaccioBin = require.resolve('verdaccio/bin/verdaccio')
	log(`Spawning Verdaccio from ${verdaccioBin}`)

	const child = spawn(
		process.execPath,
		[verdaccioBin, '--config', config.verdaccioConfigPath],
		{ stdio: 'pipe', detached: false },
	)

	if (!child.pid)
		throw new Error('Verdaccio spawn returned no PID')

	log(`Verdaccio PID: ${child.pid}`)

	child.stdout?.on('data', chunk => process.stdout.write(` [verdaccio] ${chunk}`))
	child.stderr?.on('data', chunk => process.stderr.write(` [verdaccio] ${chunk}`))
	child.on('error', error => {
		fail(`Verdaccio spawn error: ${error.message}`)
		process.exit(1)
	})
	child.on('exit', (code, signal) => {
		if (code != null && code !== 0) warn(`Verdaccio exited with code ${code}`)
		if (signal) warn(`Verdaccio killed by ${signal}`)
	})

	await waitUntilReady()
	writePublishAuth()

	return { process: child, reused: false }
}


// Module-level guard: shutdown may be called from multiple paths (signal
// handlers, main() finally block, top-level catch). Idempotent by design.
let shutdownStarted = false

export async function shutdown(handle: RegistryHandle): Promise<void> {
	// Always try to remove our publish auth, regardless of whether we spawned
	// the registry. If we reused, another instance may still need it -- noted.
	removePublishAuth()

	if (shutdownStarted) return
	shutdownStarted = true

	if (handle.process && !handle.process.killed) {
		log(`Stopping Verdaccio (PID ${handle.process.pid})`)
		handle.process.kill('SIGTERM')
		await waitForExit(handle.process, config.killTimeoutMs)
	}
}