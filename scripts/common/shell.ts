// scripts/common/shell.ts
//
// Cross-platform shell exec.
//
// We use execSync(string) rather than execFile([cmd, ...args]) because
// Windows resolves *.cmd shims (tsc.cmd, pnpm.cmd in node_modules/.bin/)
// transparently through the shell. execFile would need shell:true or manual
// binary lookup. /bin/sh on POSIX honours PATH, so the same string works there.
//
// Binaries living in node_modules/.bin/ aren't on PATH unless the launcher
// adds them (e.g. `pnpm run`). Callers invoke via `pnpm exec <bin>` so
// resolution is consistent regardless of how this process was started.
//
// No try/catch: execSync throws an Error with .stdout, .stderr, .status,
// and a descriptive message intact. Top-level entry handlers print these
// directly via exitWithError.

import { execSync, type ExecSyncOptionsWithStringEncoding } from 'node:child_process'
import { log } from './log.js'

export interface ShellOptions {
	cwd?: string
	env?: NodeJS.ProcessEnv
	silent?: boolean
}

export class Shell {
	private readonly defaults: ShellOptions

	constructor(defaults: ShellOptions = {}) {
		this.defaults = defaults
	}

	run(command: string, override: ShellOptions = {}): void {
		const opts = this.merge(override)
		if (!opts.silent) log(` $ ${command}`)

		const execOpts: ExecSyncOptionsWithStringEncoding = {
			stdio: 'pipe',
			encoding: 'utf8',
			cwd: opts.cwd,
			env: opts.env,
		}

		execSync(command, execOpts)
	}

	private merge(override: ShellOptions): ShellOptions {
		return {
			cwd: override.cwd ?? this.defaults.cwd,
			env: override.env ?? this.defaults.env ?? process.env,
			silent: override.silent ?? this.defaults.silent,
		}
	}
}
