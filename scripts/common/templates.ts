// scripts/common/templates.ts
//
// Every generated config / scaffold file is defined here as a pure function.
// Path segments come from config.names so nothing is hardcoded.

import { config } from './config.js'

const { names } = config

// -- Helper: inline-safe stringify for use inside double-quoted `node -e "..."` --
// Single quotes inside are fine; double quotes would collide with the outer quotes.
function inlineJson(obj: Record<string, unknown>): string {
	return JSON.stringify(obj).replace(/"/g, "\\\"")
}

export interface VerdaccioYamlArgs {
	storageDir: string
	namespace: string
	port: string
}

export function verdaccioYaml({ storageDir, namespace, port }: VerdaccioYamlArgs): string {
	return [
		`storage: '${storageDir}'`,
		``,
		`uplinks:`,
		`  npmjs:`,
		`    url: https://registry.npmjs.org/`,
		``,
		`packages:`,
		`  '@${namespace}/*':`,
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
		`listen: '0.0.0.0:${port}'`,
		``,
		`log:`,
		`  type: stdout`,
		`  format: pretty`,
		`  level: warn`,
	].join('\n')
}

export interface NpmrcArgs {
	namespace: string
	registryUrl: string
	registryHost: string
	authToken: string
}

export function npmrc({ namespace, registryUrl, registryHost, authToken }: NpmrcArgs): string {
	return [
		`@${namespace}:registry=${registryUrl}`,
		`//${registryHost}/:_authToken=${authToken}`,
		``,
	].join('\n')
}

export interface PackageJsonArgs {
	namespace: string
	name: string
	version: string
	dependencies: string[]
}

export function packageJson({ namespace, name, version, dependencies }: PackageJsonArgs): string {
	// The post-build write of {"type":"commonjs"} into dist/cjs/ is how dual
	// packages tell Node to treat the CJS output as CommonJS at runtime.
	// We use `require('fs')` (not bare `fs`) because `fs` is NOT a Node global.
	// `node -e` evaluates in CJS mode regardless of the enclosing package.json
	// "type" field, so require() is always available.
	const rmDist = `node -e "require('fs').rmSync('${names.dist}',{recursive:true,force:true})"`

	const pkg: Record<string, unknown> = {
		name: `@${namespace}/${name}`,
		version,
		type: 'module',
		exports: {
			'.': {
				import: {
					types: `./${names.distEsm}/index.d.ts`,
					default: `./${names.distEsm}/index.js`,
				},
			},
		},
		files: [names.dist],
		scripts: {
			build: [
				'tsc -p tsconfig.json',
			].join(' && '),
			clean: rmDist,
		},
		devDependencies: {
			typescript: '^6.0.2',
		},
	}

	// Workspace deps go into `dependencies`, NOT `devDependencies`.
	// Consumers installing this package need them at runtime (transitive install).
	if (dependencies.length > 0) {
		const deps: Record<string, string> = {}
		for (const dep of dependencies)
			deps[`@${namespace}/${dep}`] = 'workspace:^'
		pkg.dependencies = deps
	}

	return JSON.stringify(pkg, null, '\t')
}

export interface TsconfigEsmArgs {
	references: string[]
}

export function tsconfigEsm({ references }: TsconfigEsmArgs): string {
	const tsconfig: Record<string, unknown> = {
		extends: '../../tsconfig.base.json',
		compilerOptions: {
			rootDir: names.src,
			outDir: names.distEsm,
		},
		include: [names.src],
	}

	if (references.length > 0)
		tsconfig.references = references.map(ref => ({ path: `../${ref}` }))

	return JSON.stringify(tsconfig, null, '\t')
}

export function indexTs(): string {
	return `// entry point\n`
}