// scripts/common/registry.ts
//
// Registry        - Verdaccio process lifecycle (spawn, wait-ready, stop).
//                   Owns YAML config generation and the killTimeout fallback.
//
// RegistryClient  - HTTP queries against the running registry. Centralizes
//                   the auth env-vars used to publish.
//
// Auth model: we do NOT write any .npmrc anywhere on the user's filesystem.
// The previous design wrote an ephemeral .npmrc at monorepo root. Problems:
//   1. Overwrote any user-owned .npmrc at that path.
//   2. Left a stale .npmrc if the process crashed between write and delete.
//   3. Concurrent bootstrap invocations raced on the file.
//   4. The clean script also reached into the user's *global* pnpm config,
//      which had nothing to do with our registry.
//
// Instead, RegistryClient.publishEnv() builds a `npm_config_*` env-var
// dictionary that is passed only to the publish subprocess. npm/pnpm honour
// env vars at higher priority than any .npmrc file, and setting
// npm_config_userconfig=os.devNull blocks the home-level .npmrc from leaking
// into our publish at all. Zero file writes, zero global state mutation.

import { spawn, type ChildProcess } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { devNull } from 'node:os'
import { config } from './config.js'
import { log, warn } from './log.js'

const require = createRequire(import.meta.url)
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))


// -- HTTP client --

interface PackageDoc {
	'dist-tags': { latest: string }
}

interface VersionDoc {
	name: string
	version: string
}

export class RegistryClient {
	getUrl(): string {
		return config.registryUrl
	}

	publishEnv(): NodeJS.ProcessEnv {
		const tokenKey = `npm_config_//${config.registryHost}/:_authToken`
		return {
			...process.env,
			[tokenKey]: config.authToken,
			npm_config_registry: config.registryUrl,
			npm_config_userconfig: devNull,
		}
	}

	// Probe-style: failure to respond is the documented "not yet running"
	// case, not an error. Catch is intentional and narrow.
	async ping(timeoutMs: number = 1_500): Promise<boolean> {
		try {
			const response = await fetch(config.pingUrl, { signal: AbortSignal.timeout(timeoutMs) })
			return response.ok
		} catch {
			return false
		}
	}

	async getLatestVersion(name: string): Promise<string | null> {
		const url = `${config.registryUrl}/${encodeURIComponent(name)}`
		const response = await fetch(url, { signal: AbortSignal.timeout(config.fetchTimeoutMs) })

		if (response.status === 404) return null
		if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`)

		const doc = await response.json() as PackageDoc
		return doc['dist-tags'].latest
	}

	async assertPublished(name: string, version: string): Promise<void> {
		const url = `${config.registryUrl}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`
		const response = await fetch(url, { signal: AbortSignal.timeout(config.fetchTimeoutMs) })

		if (!response.ok)
			throw new Error(`HTTP ${response.status} verifying ${name}@${version}`)

		const doc = await response.json() as VersionDoc
		if (doc.name !== name || doc.version !== version)
			throw new Error(`Registry returned ${doc.name}@${doc.version} for ${name}@${version}`)
	}
}


// -- Server lifecycle --

export interface RegistryHandle {
	process: ChildProcess | null
	reused: boolean
}

export class Registry {
	private readonly client: RegistryClient

	// Module-level guard: shutdown may be called from multiple paths (signal
	// handlers, main()'s finally block, top-level catch). Idempotent by design.
	private shutdownStarted = false

	constructor(client: RegistryClient) {
		this.client = client
	}

	async ensureRunning(): Promise<RegistryHandle> {
		if (await this.client.ping()) {
			log('Registry already running, reusing')
			return { process: null, reused: true }
		}

		this.generateConfigFile()

		const verdaccioBin = require.resolve('verdaccio/bin/verdaccio')
		log(`Spawning Verdaccio from ${verdaccioBin}`)

		const child = spawn(
			process.execPath,
			[verdaccioBin, '--config', config.verdaccioConfigPath],
			{ stdio: 'pipe', detached: false },
		)

		if (!child.pid) throw new Error('Verdaccio spawn returned no PID')
		if (!child.stdout) throw new Error('Verdaccio child has no stdout')
		if (!child.stderr) throw new Error('Verdaccio child has no stderr')

		log(`Verdaccio PID: ${child.pid}`)

		child.stdout.on('data', chunk => process.stdout.write(` [verdaccio] ${chunk}`))
		child.stderr.on('data', chunk => process.stderr.write(` [verdaccio] ${chunk}`))
		child.on('error', error => {
			console.error(`Verdaccio spawn error: ${error.message}`)
			process.exit(1)
		})
		child.on('exit', (code, signal) => {
			if (code != null && code !== 0) warn(`Verdaccio exited with code ${code}`)
			if (signal) warn(`Verdaccio killed by ${signal}`)
		})

		await this.waitForReady()
		return { process: child, reused: false }
	}

	async shutdown(handle: RegistryHandle): Promise<void> {
		if (this.shutdownStarted) return
		this.shutdownStarted = true

		if (handle.process && !handle.process.killed) {
			log(`Stopping Verdaccio (PID ${handle.process.pid})`)
			handle.process.kill('SIGTERM')
			await this.waitForExit(handle.process, config.killTimeoutMs)
		}
	}

	private async waitForReady(): Promise<void> {
		const deadline = Date.now() + config.pingTimeoutMs
		let attempts = 0

		while (Date.now() < deadline) {
			attempts++
			if (await this.client.ping()) {
				log(`Registry ready after ${attempts} ping(s)`)
				return
			}
			await sleep(config.pingIntervalMs)
		}

		throw new Error(`Registry did not respond within ${config.pingTimeoutMs}ms`)
	}

	private waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
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

	private generateConfigFile(): void {
		mkdirSync(config.verdaccioDir, { recursive: true })
		writeFileSync(config.verdaccioConfigPath, this.verdaccioYaml(), 'utf8')
		log(`Generated verdaccio config at ${config.verdaccioConfigPath}`)
	}

	private verdaccioYaml(): string {
		return [
			`storage: '${config.storageDir}'`,
			``,
			`uplinks:`,
			`  npmjs:`,
			`    url: https://registry.npmjs.org/`,
			``,
			`packages:`,
			`  '@${config.namespace}/*':`,
			`    access: $all`,
			`    publish: $all`,
			`    unpublish: $all`,
			``,
			`  '**':`,
			`    access: $all`,
			`    proxy: npmjs`,
			``,
			`server:`,
			`  keepAliveTimeout: 60`,
			``,
			`listen: '${config.registryHostname}:${config.port}'`,
			``,
			`log:`,
			`  type: stdout`,
			`  format: pretty`,
			`  level: warn`,
		].join('\n')
	}
}
