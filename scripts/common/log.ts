// scripts/common/log.ts

const timestamp = (): string => new Date().toISOString().slice(11, 23)

export function log(...args: unknown[]): void {
	console.log(`[${timestamp()}]`, ...args)
}

export function warn(...args: unknown[]): void {
	console.warn(`[${timestamp()}] WARN`, ...args)
}

// Top-level entry handler. Prints the error verbatim, then dumps any
// captured subprocess stdio (execSync errors carry .stdout/.stderr fields
// that console.error doesn't surface), then exits.
export function exitWithError(error: unknown): never {
	console.error(error)
	const subprocess = error as { stdout?: string | Buffer, stderr?: string | Buffer }
	if (subprocess.stdout) {
		console.error(subprocess.stdout)
		process.stdout.write(subprocess.stdout)
	}
	if (subprocess.stderr) {
		console.error(subprocess.stderr)
		process.stderr.write(subprocess.stderr)
	}
	process.exit(1)
}
