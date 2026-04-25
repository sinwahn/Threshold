// scripts/common/errors.ts
//
// Layer-specific error types. Every catch+rethrow site passes the original
// error as `cause` so the full stack trace survives across layer boundaries.
// Top-level handlers (in bootstrap.ts / clean.ts / scaffold.ts) decide what
// to do with each type; internal code never inspects errors, only throws.

export class BootstrapError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options)
		this.name = this.constructor.name
	}
}

export class WorkspaceError extends BootstrapError {}
export class RegistryError extends BootstrapError {}
export class BuildError extends BootstrapError {}
export class PublishError extends BootstrapError {}
export class ScaffoldError extends BootstrapError {}

// ShellError carries the captured stdio of the failed command so the
// top-level handler can print the actual subprocess output, not just our
// wrapper message. We don't print it on construction -- that decision
// belongs to whoever catches it.
export interface ShellFailureInfo {
	exitCode: number | null
	stdout: string
	stderr: string
}

export class ShellError extends BootstrapError {
	readonly exitCode: number | null
	readonly stdout: string
	readonly stderr: string

	constructor(action: string, info: ShellFailureInfo, options?: ErrorOptions) {
		super(`${action} failed (exit ${info.exitCode ?? '?'})`, options)
		this.exitCode = info.exitCode
		this.stdout = info.stdout
		this.stderr = info.stderr
	}
}

export function reportError(error: unknown): void {
	if (error instanceof ShellError) {
		console.error(`${error.name}: ${error.message}`)
		if (error.stdout) console.error(`stdout:\n${error.stdout}`)
		if (error.stderr) console.error(`stderr:\n${error.stderr}`)
		return
	}
	if (error instanceof Error) {
		console.error(`${error.name}: ${error.message}`)
		if (error.cause) console.error('Caused by:', error.cause)
		return
	}
	console.error(error)
}
