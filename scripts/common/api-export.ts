// scripts/common/api-export.ts

import ts from 'typescript'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { config } from './config.js'
import { log } from './log.js'

interface ExtractOptions {
	includeComments: boolean
	includeTypes: boolean
	includePrivateReferences: boolean
}

interface ClassifiedDeclaration {
	statement: ts.Statement
	isPublic: boolean
}

const defaultOptions: ExtractOptions = {
	includeComments: true,
	includeTypes: true,
	includePrivateReferences: true,
}

const compilerOptions: ts.CompilerOptions = {
	target: ts.ScriptTarget.ESNext,
	module: ts.ModuleKind.ESNext,
	moduleResolution: ts.ModuleResolutionKind.NodeNext,
	skipLibCheck: true,
	// allowJs off; we're reading .d.ts which tsc parses natively.
}


// -- Public entry --

export function exportApi(options: ExtractOptions = defaultOptions): void {
	const outDir = join(config.outputDir, 'api')
	if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })

	const packageNames = readdirSync(config.packagesDir)
	for (const name of packageNames)
		processPackage(name, outDir, options)

	log(`Exported API for ${packageNames.length} package(s) to ${outDir}`)
}


// -- Per-package processing --

function processPackage(packageName: string, outDir: string, options: ExtractOptions): void {
	const entryFile = resolveEntryFile(packageName)
	if (!entryFile) return

	const apiText = extractPackageApi(entryFile, options)
	const formatted = compactApiText(apiText)

	const destination = join(outDir, `${packageName}-api.ts`)
	writeFileSync(destination, formatted, 'utf8')
}

function resolveEntryFile(packageName: string): string | undefined {
	// Prefer dist/*.d.ts: tsc has already stripped implementations, method bodies,
	// initializers, and private-but-not-referenced helpers. Reading .ts source
	// would force us to hand-roll body stripping for every TS construct.
	//
	// Caveat: if a type in ip.ts is used internally but never exported, tsc may
	// have inlined or widened it during emit -- it won't appear in ip.d.ts at all.
	// That's fine because no TypeReferenceNode in the emitted .d.ts will point
	// at it either.
	const candidates = [
		join(config.packagesDir, packageName, 'dist', 'index.d.ts'),
		join(config.packagesDir, packageName, 'src', 'index.ts'),
	]
	return candidates.find(path => existsSync(path))
}


// -- API extraction (TS compiler API) --

function extractPackageApi(entryFile: string, options: ExtractOptions): string {
	const program = ts.createProgram([entryFile], compilerOptions)
	const checker = program.getTypeChecker()
	const sourceFile = program.getSourceFile(entryFile)
	if (!sourceFile) throw new Error(`Cannot load ${entryFile}`)

	const moduleSymbol = checker.getSymbolAtLocation(sourceFile)
	if (!moduleSymbol) return ''

	const publicExports = checker.getExportsOfModule(moduleSymbol)
	const publicStatements = collectPublicStatements(publicExports, checker)
	const allStatements = options.includePrivateReferences
		? expandToTransitiveClosure(publicStatements, checker)
		: publicStatements

	const classified = classifyStatements(allStatements, publicStatements)
	const filtered = filterByOptions(classified, options)

	return renderStatements(filtered, options)
}

function collectPublicStatements(exports: ts.Symbol[], checker: ts.TypeChecker): Set<ts.Statement> {
	// Each exported symbol may be an alias (e.g. `export { Foo } from './ip.js'`).
	// We follow the alias chain to the real declaration before locating its
	// containing statement -- otherwise we'd grab the re-export line itself,
	// which leaves unresolved cross-file references in the output.
	const statements = new Set<ts.Statement>()
	for (const symbol of exports) {
		const resolved = resolveAliasChain(symbol, checker)
		for (const declaration of resolved.getDeclarations() ?? []) {
			const statement = findContainingStatement(declaration)
			if (!statement) continue
			if (isReExportDeclaration(statement)) continue
			statements.add(statement)
		}
	}
	return statements
}

function expandToTransitiveClosure(publicStatements: Set<ts.Statement>, checker: ts.TypeChecker): Set<ts.Statement> {
	const collected = new Set<ts.Statement>(publicStatements)
	const worklist: ts.Statement[] = [...publicStatements]

	while (worklist.length > 0) {
		const statement = worklist.pop()!
		collectReferencedSymbols(statement, checker, referencedSymbol => {
			for (const declaration of referencedSymbol.getDeclarations() ?? []) {
				const referenced = findContainingStatement(declaration)
				if (!referenced) continue
				if (collected.has(referenced)) continue
				if (isExternalDeclaration(referenced)) continue
				if (isReExportDeclaration(referenced)) continue
				collected.add(referenced)
				worklist.push(referenced)
			}
		})
	}

	return collected
}

function collectReferencedSymbols(root: ts.Node, checker: ts.TypeChecker, onSymbol: (symbol: ts.Symbol) => void): void {
	const visit = (node: ts.Node): void => {
		const symbol = resolveReferenceAt(node, checker)
		if (symbol) onSymbol(symbol)
		ts.forEachChild(node, visit)
	}
	visit(root)
}

function resolveReferenceAt(node: ts.Node, checker: ts.TypeChecker): ts.Symbol | undefined {
	const rawSymbol = readReferenceSymbol(node, checker)
	if (!rawSymbol) return undefined
	return resolveAliasChain(rawSymbol, checker)
}

function readReferenceSymbol(node: ts.Node, checker: ts.TypeChecker): ts.Symbol | undefined {
	if (ts.isTypeReferenceNode(node)) return checker.getSymbolAtLocation(node.typeName)
	if (ts.isExpressionWithTypeArguments(node)) return checker.getSymbolAtLocation(node.expression)
	if (ts.isTypeQueryNode(node)) return checker.getSymbolAtLocation(node.exprName)
	return undefined
}

function resolveAliasChain(symbol: ts.Symbol, checker: ts.TypeChecker): ts.Symbol {
	// Walk the alias chain fully -- a symbol can be aliased multiple times
	// (re-export of a re-export). getAliasedSymbol only takes one hop.
	let current = symbol
	while (current.flags & ts.SymbolFlags.Alias) {
		const next = checker.getAliasedSymbol(current)
		if (next === current) break
		current = next
	}
	return current
}

function isReExportDeclaration(statement: ts.Statement): boolean {
	// Matches `export { Foo } from './ip.js'` and `export * from './ip.js'`.
	// We never want these in the output -- their referents have already been
	// inlined via alias resolution.
	if (!ts.isExportDeclaration(statement)) return false
	return statement.moduleSpecifier !== undefined
}

function classifyStatements(all: Set<ts.Statement>, publicOnes: Set<ts.Statement>): ClassifiedDeclaration[] {
	return [...all].map(statement => ({
		statement,
		isPublic: publicOnes.has(statement),
	}))
}

function filterByOptions(classified: ClassifiedDeclaration[], options: ExtractOptions): ClassifiedDeclaration[] {
	if (options.includeTypes) return classified
	return classified.filter(entry => !isPureTypeDeclaration(entry.statement))
}

function renderStatements(classified: ClassifiedDeclaration[], options: ExtractOptions): string {
	const publicParts: string[] = []
	const privateParts: string[] = []

	for (const entry of classified) {
		const rendered = renderSingleStatement(entry, options)
		if (entry.isPublic) publicParts.push(rendered)
		else privateParts.push(rendered)
	}

	const sections: string[] = []
	if (publicParts.length > 0)
		sections.push(publicParts.join('\n\n'))
	if (privateParts.length > 0)
		sections.push('// -- Internal types referenced by the public API --\n\n' + privateParts.join('\n\n'))
	return sections.join('\n\n')
}

function renderSingleStatement(entry: ClassifiedDeclaration, options: ExtractOptions): string {
	const sourceText = readDeclarationText(entry.statement, options)
	return entry.isPublic ? sourceText : `/** @internal */\n${sourceText}`
}

function readDeclarationText(statement: ts.Statement, options: ExtractOptions): string {
	const sourceFile = statement.getSourceFile()
	const fullText = sourceFile.getFullText()
	const start = options.includeComments ? statement.getFullStart() : statement.getStart()
	const end = statement.getEnd()
	const rawText = fullText.slice(start, end)
	const text = options.includeComments ? keepOnlyJsDoc(rawText) : rawText
	return text.trim()
}

function keepOnlyJsDoc(text: string): string {
	return text
		.replace(/^\s*\/\/.*$/gm, '')
		.replace(/\/\*(?!\*)[\s\S]*?\*\//g, '')
		.replace(/\n{3,}/g, '\n\n')
		.trimStart()
}

function findContainingStatement(node: ts.Node): ts.Statement | undefined {
	let current: ts.Node | undefined = node
	while (current && current.parent && !ts.isSourceFile(current.parent))
		current = current.parent
	if (!current) return undefined
	return ts.isSourceFile(current.parent) ? (current as ts.Statement) : undefined
}

function isPureTypeDeclaration(node: ts.Node): boolean {
	return ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)
}

function isExternalDeclaration(node: ts.Node): boolean {
	const fileName = node.getSourceFile().fileName
	if (fileName.includes('/node_modules/')) return true
	if (fileName.endsWith('.d.ts') && fileName.includes('/typescript/lib/')) return true
	return false
}


// -- Output formatter --
//
// TODO: keep as is, but move to abyss as a separate package.
//
// Order matters: each step operates on the result of the previous one.
// Comments are stripped first so subsequent whitespace rules don't have to
// worry about them; semicolons are dropped after newline normalization so
// `;\n` patterns are detected correctly regardless of original spacing.

function compactApiText(code: string): string {
	let out = code
	out = out.replace(/\/\*[\s\S]*?\*\//g, '')             // block comments
	out = out.replace(/declare /g, '')                      // strip 'declare' keyword
	out = out.replace(/\t/g, ' ')                           // tabs to spaces
	out = out.replace(/ +/g, ' ')                           // collapse runs of spaces
	out = out.replace(/ *\n /g, '\n')                       // strip leading-space residue at line starts
	out = out.replace(/;\n/g, '\n')                         // drop terminal semicolons
	out = out.replace(/\n\n/g, '\n')                        // collapse blank lines
	out = out.replace(/ ?([()[\]|?&:.,<>=]) ?/g, '$1')      // tighten around punctuation
	return out
}
