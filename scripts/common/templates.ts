// scripts/common/templates.ts
//
// Pure functions producing the file contents written by scaffold.ts and
// create-npmrc.ts. Path segments come from config.names so renaming a folder
// is a one-line change. These are the only places writing config files into
// the workspace; everything else either runs in-memory or writes to data/.

import { config } from './config.js'

const { names } = config

export interface PackageJsonArgs {
	namespace: string
	name: string
	version: string
	dependencies: string[]
}

export function packageJson({ namespace, name, version, dependencies }: PackageJsonArgs): string {
	// `node -e` evaluates in CJS mode regardless of the enclosing package.json
	// "type" field, so require() is always available. We use require('node:fs')
	// (with the explicit `node:` scheme, not bare 'fs') so the script works on
	// Node versions that have made bare 'fs' more strict in ESM contexts.
	const rmDist = `node -e "require('node:fs').rmSync('${names.dist}',{recursive:true,force:true})"`

	const pkg: Record<string, unknown> = {
		name: `@${namespace}/${name}`,
		version,
		type: 'module',
		exports: {
			'.': {
				import: {
					types: `./${names.dist}/index.d.ts`,
					default: `./${names.dist}/index.js`,
					source: `./${names.src}/index.ts`,
				},
			},
		},
		files: [names.dist],
		scripts: {
			build: 'tsc -p tsconfig.json',
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

export interface TsconfigPackageArgs {
	references: string[]
}

export function tsconfigPackage({ references }: TsconfigPackageArgs): string {
	const tsconfig: Record<string, unknown> = {
		extends: '../../tsconfig.base.json',
		compilerOptions: {
			rootDir: names.src,
			outDir: names.dist,
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
