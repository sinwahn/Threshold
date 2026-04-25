// scripts/common/publish.ts
//
// PublishPipeline: orchestrates the publish workflow for a set of packages.
// Each target goes through a fixed sequence:
//   1. Compute next version (max of local + registry, plus build counter)
//   2. Update package.json if version changed
//   3. Invoke `pnpm publish` with env-driven auth
//   4. Verify the version landed on the registry
//   5. Bump the target's stamp counters and persist
//
// Stages run in parallel across targets, capped at config.publishConcurrency.
// pnpm's publish lock serializes filesystem-touching steps internally; the
// concurrency cap mostly bounds simultaneous network round-trips to the
// local registry.

import { config } from './config.js'
import { Shell } from './shell.js'
import { RegistryClient } from './registry.js'
import { pMap } from './p-map.js'
import { log } from './log.js'
import type { Package } from './workspace.js'

export class PublishPipeline {
	private readonly registry: RegistryClient
	private readonly shell: Shell
	private readonly concurrency: number

	constructor(registry: RegistryClient, concurrency: number = config.publishConcurrency) {
		this.registry = registry
		this.concurrency = concurrency
		// One Shell with the publish env locked in. Per-call cwd is supplied
		// at the publish() site since each target has its own.
		this.shell = new Shell({ env: registry.publishEnv(), silent: false })
	}

	async run(targets: readonly Package[]): Promise<void> {
		if (targets.length === 0) {
			log('No packages to publish')
			return
		}

		log(`Publishing ${targets.length} package(s) with concurrency ${this.concurrency}`)
		await pMap(targets, this.concurrency, target => this.publish(target))
		log(`Published ${targets.length} package(s)`)
	}

	private async publish(target: Package): Promise<void> {
		const nextVersion = await this.computeNextVersion(target)

		if (nextVersion !== target.getCurrentVersion()) {
			const previous = target.getCurrentVersion()
			target.writeVersion(nextVersion)
			log(` ${target.name}: ${previous} -> ${nextVersion}`)
		}

		this.shell.run(
			`pnpm publish --registry ${this.registry.getUrl()} --tag=latest --no-git-checks`,
			{ cwd: target.path },
		)

		await this.registry.assertPublished(target.name, nextVersion)
		target.markPublished()
		log(` Published ${target.name}@${nextVersion}`)
	}

	private async computeNextVersion(target: Package): Promise<string> {
		const registryVersion = await this.registry.getLatestVersion(target.name)
		const baseVersion = pickHigher(target.getCurrentVersion(), registryVersion)
		const cleanBase = stripPrerelease(baseVersion)
		return `${cleanBase}-build.${target.getNextBuildNumber()}`
	}
}


// -- Version helpers --

function pickHigher(localVersion: string, registryVersion: string | null): string {
	if (!registryVersion) return localVersion
	return compareVersions(localVersion, registryVersion) > 0 ? localVersion : registryVersion
}

function stripPrerelease(version: string): string {
	return version.replace(/-.*$/, '')
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
