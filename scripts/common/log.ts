// scripts/common/log.ts

const timestamp = (): string => new Date().toISOString().slice(11, 23)

export function log(...args: unknown[]): void {
	console.log(`[${timestamp()}]`, ...args)
}

export function warn(...args: unknown[]): void {
	console.warn(`[${timestamp()}] WARN`, ...args)
}

export function fail(...args: unknown[]): void {
	console.error(`[${timestamp()}] ERR`, ...args)
}