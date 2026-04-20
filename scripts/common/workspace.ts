// scripts/common/workspace.ts
import { execSync } from 'node:child_process'

export interface WorkspacePackage {
	name: string
	version: string
	path: string
	private?: boolean
}

export function discoverPackages(): WorkspacePackage[] {
	const raw = execSync('pnpm -r ls --json --depth -1', { encoding: 'utf8' })
	const parsed = JSON.parse(raw) as WorkspacePackage[]
	return parsed.filter(p => p.name && p.version)
}