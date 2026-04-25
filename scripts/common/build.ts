// scripts/common/build.ts
//
// Single-shot tsc invocation against the solution-style tsconfig.build.json.
// tsc's own composite/incremental machinery handles unchanged-input skipping;
// we don't compute a per-package "what to build" set.
//
// `pnpm exec tsc` rather than bare `tsc`: locates the workspace's TypeScript
// regardless of whether node_modules/.bin/ is on PATH. Bare `tsc` worked when
// invoked via `pnpm run` (which adds .bin to PATH) but failed when run
// directly through VSCode's launch.json.

import { config } from './config.js'
import { Shell } from './shell.js'
import { log } from './log.js'

const shell = new Shell({ cwd: config.rootDir })

export function build(forceRebuild: boolean): void {
	log(forceRebuild ? 'Force rebuilding all packages' : 'Building (incremental)')
	const flag = forceRebuild ? ' --force' : ''
	shell.run(`pnpm exec tsc --build ${config.names.tsconfigBuild}${flag}`)
	log('Build complete')
}
