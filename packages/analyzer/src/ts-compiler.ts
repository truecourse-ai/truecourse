/**
 * TypeScript Compiler API utilities for module resolution, export detection,
 * and polymorphic dispatch resolution.
 *
 * Three layers:
 * - Layer 1: Module resolution (no program needed, fast)
 * - Layer 2: Export detection (needs ts.createProgram + type checker)
 * - Layer 3: Polymorphic resolution (uses same type checker from Layer 2)
 */

import * as ts from 'typescript'
import { dirname, join } from 'path'
import { existsSync, readdirSync, statSync } from 'fs'
import { monorepoPatterns } from './patterns/service-patterns.js'

// ---------------------------------------------------------------------------
// Layer 1: Module resolution
// ---------------------------------------------------------------------------

export interface ScopedCompilerOptions {
  dir: string
  options: ts.CompilerOptions
  cache: ts.ModuleResolutionCache
}

const moduleResolutionHost: ts.ModuleResolutionHost = {
  fileExists: ts.sys.fileExists,
  readFile: ts.sys.readFile,
  directoryExists: ts.sys.directoryExists,
}

/**
 * Build a CompilerHost anchored at `repoPath` instead of `process.cwd()`.
 *
 * Without this, `ts.createProgram(files, options)` falls back to
 * `ts.createCompilerHost(options)` which uses `ts.sys.getCurrentDirectory()`
 * (i.e. `process.cwd()`). That makes typeRoots / `@types` lookup pull from
 * the *parent process's* `node_modules` — so the same analyzer call returns
 * different counts depending on where the CLI / dashboard server was
 * launched. Anchoring at the analyzed repo makes results CWD-independent.
 */
function createRepoScopedCompilerHost(
  repoPath: string,
  options: ts.CompilerOptions,
): ts.CompilerHost {
  const host = ts.createCompilerHost(options)
  host.getCurrentDirectory = () => repoPath
  return host
}

/**
 * Find and parse all tsconfig.json files in the repo. Returns scoped compiler
 * options sorted by directory depth (most specific first) so file lookups
 * match the correct package.
 */
export function buildScopedCompilerOptions(rootPath: string): ScopedCompilerOptions[] {
  const result: ScopedCompilerOptions[] = []

  // Collect tsconfig candidates: root + monorepo package directories
  const candidates = [join(rootPath, 'tsconfig.json')]
  for (const pattern of monorepoPatterns) {
    const dirPath = join(rootPath, pattern)
    if (!existsSync(dirPath) || !statSync(dirPath).isDirectory()) continue
    try {
      for (const entry of readdirSync(dirPath).sort()) {
        candidates.push(join(dirPath, entry, 'tsconfig.json'))
      }
    } catch { /* skip */ }
  }

  for (const tsconfigPath of candidates) {
    if (!existsSync(tsconfigPath)) continue
    try {
      const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile)
      if (configFile.error) continue

      const tsconfigDir = dirname(tsconfigPath)
      const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, tsconfigDir)

      const cache = ts.createModuleResolutionCache(
        rootPath,
        (s) => s.toLowerCase(),
        parsed.options,
      )

      result.push({ dir: tsconfigDir, options: parsed.options, cache })
    } catch { /* skip invalid tsconfig */ }
  }

  // Sort by directory depth descending — most specific paths match first
  result.sort((a, b) => b.dir.length - a.dir.length)

  return result
}

/**
 * Find the compiler options that apply to a given file path.
 */
function findOptionsForFile(filePath: string, scoped: ScopedCompilerOptions[]): ScopedCompilerOptions | null {
  for (const entry of scoped) {
    if (filePath.startsWith(entry.dir + '/')) {
      return entry
    }
  }
  // Fall back to root tsconfig if available
  return scoped[scoped.length - 1] ?? null
}

/**
 * Resolve a module specifier to an absolute file path using the TypeScript
 * compiler's module resolution. Handles path aliases, workspace packages,
 * barrel re-exports, extension probing, and all moduleResolution strategies.
 */
export function resolveModule(
  specifier: string,
  containingFile: string,
  scoped: ScopedCompilerOptions[],
): string | null {
  const entry = findOptionsForFile(containingFile, scoped)
  if (!entry) return null

  const result = ts.resolveModuleName(
    specifier,
    containingFile,
    entry.options,
    moduleResolutionHost,
    entry.cache,
  )

  const resolved = result.resolvedModule?.resolvedFileName
  if (!resolved) return null

  // Skip .d.ts files — we want source files only
  if (resolved.endsWith('.d.ts')) return null

  return resolved
}

// ---------------------------------------------------------------------------
// Layers 2+3: Export detection + polymorphic resolution (shared program)
// ---------------------------------------------------------------------------

export interface SemanticAnalysisResult {
  /** Map of file path → set of exported names */
  exportMap: Map<string, Set<string>>
  /** Map of interface method name → set of implementing class names */
  interfaceImplementations: Map<string, Set<string>>
}

/**
 * Create a single ts.Program and extract both export information and interface
 * implementation data in one pass. This avoids creating the program twice.
 *
 * The type checker correctly handles re-exports, barrel files, grouped exports,
 * and default exports. Interface implementation detection enables resolving
 * polymorphic method calls (e.g., `channel.send()` → `LinqChannel.send`).
 */
export function analyzeSemantics(
  filePaths: string[],
  scoped: ScopedCompilerOptions[],
  repoPath: string,
): SemanticAnalysisResult {
  const baseOptions = scoped[scoped.length - 1]?.options ?? {}
  const options: ts.CompilerOptions = {
    ...baseOptions,
    skipLibCheck: true,
    noEmit: true,
  }

  const host = createRepoScopedCompilerHost(repoPath, options)
  const program = ts.createProgram(filePaths, options, host)
  const checker = program.getTypeChecker()

  const exportMap = new Map<string, Set<string>>()
  const interfaceMethods = new Set<string>()
  const implementations = new Map<string, Set<string>>()

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue

    // --- Export detection ---
    const fileSymbol = checker.getSymbolAtLocation(sourceFile)
    if (fileSymbol) {
      const exports = checker.getExportsOfModule(fileSymbol)
      const names = new Set<string>()
      for (const exp of exports) {
        names.add(exp.getName())
      }
      exportMap.set(sourceFile.fileName, names)
    }

    // --- Interface + class implementation detection ---
    ts.forEachChild(sourceFile, function visit(node) {
      if (ts.isInterfaceDeclaration(node)) {
        for (const member of node.members) {
          if ((ts.isMethodSignature(member) || ts.isPropertySignature(member)) && member.name) {
            interfaceMethods.add(member.name.getText())
          }
        }
      }

      if (ts.isClassDeclaration(node) && node.name) {
        const className = node.name.getText()
        const heritageClauses = node.heritageClauses
        if (heritageClauses) {
          const hasHeritage = heritageClauses.some(
            (clause) =>
              clause.token === ts.SyntaxKind.ImplementsKeyword ||
              clause.token === ts.SyntaxKind.ExtendsKeyword,
          )
          if (hasHeritage) {
            for (const member of node.members) {
              if (ts.isMethodDeclaration(member) && member.name) {
                const methodName = member.name.getText()
                if (!implementations.has(methodName)) {
                  implementations.set(methodName, new Set())
                }
                implementations.get(methodName)!.add(className)
              }
            }
          }
        }
      }

      ts.forEachChild(node, visit)
    })
  }

  // Filter implementations to only methods defined in interfaces
  const interfaceImplementations = new Map<string, Set<string>>()
  for (const [methodName, classNames] of implementations) {
    if (interfaceMethods.has(methodName)) {
      interfaceImplementations.set(methodName, classNames)
    }
  }

  return { exportMap, interfaceImplementations }
}

// ---------------------------------------------------------------------------
// Layer 4: Type query service (kept alive for rule visitors)
// ---------------------------------------------------------------------------

export interface TypeQueryService {
  /** Get the type of an expression at a position (optionally span-aware with end position) */
  getTypeAtPosition(filePath: string, line: number, column: number, endLine?: number, endColumn?: number): string | null
  /** Check if a type is assignable to Promise */
  isPromiseLike(filePath: string, line: number, column: number, endLine?: number, endColumn?: number): boolean
  /** Get return type of a function */
  getReturnType(filePath: string, line: number, column: number, endLine?: number, endColumn?: number): string | null
  /** Get the type string for display */
  getTypeString(filePath: string, line: number, column: number, endLine?: number, endColumn?: number): string | null
  /** Check if type is 'any' */
  isAnyType(filePath: string, line: number, column: number, endLine?: number, endColumn?: number): boolean
  /**
   * Check if the `any` at this position originates from an unresolved or
   * external import (i.e. a third-party library whose types aren't in our
   * program). Returns true when the symbol traces back to an `import`
   * declaration or to a value whose initializer chain crosses an import,
   * and false when the any-ness is anchored by an explicit `: any`
   * annotation or `as any` cast in user code. Use this to filter
   * isAnyType-driven rules so they don't fire on every external-lib call
   * when the analyzed target hasn't installed its node_modules.
   *
   * Returns false if the position isn't an any-typed expression (callers
   * are expected to check `isAnyType` first; this method only decides the
   * source of an existing `any`).
   */
  isAnyFromExternalSource(filePath: string, line: number, column: number, endLine?: number, endColumn?: number): boolean
  /** Check if type is void/undefined */
  isVoidType(filePath: string, line: number, column: number, endLine?: number, endColumn?: number): boolean
  /** Check if type is boolean */
  isBooleanType(filePath: string, line: number, column: number, endLine?: number, endColumn?: number): boolean
  /** Check if type is a number */
  isNumberType(filePath: string, line: number, column: number, endLine?: number, endColumn?: number): boolean
  /** Get parameter types of a function/method */
  getParameterTypes(filePath: string, line: number, column: number, endLine?: number, endColumn?: number): Array<{ name: string; type: string }> | null
  /** Check if two positions have compatible types */
  areTypesCompatible(filePath: string, line1: number, col1: number, line2: number, col2: number): boolean
  /** Check if the TS compiler reports a type error in a line range. If
   * `errorCodes` is provided, only diagnostics whose `code` matches are
   * considered — used to ignore unrelated diagnostics (unresolved modules,
   * missing names) that aren't actual argument-type mismatches. */
  hasTypeErrorInRange(filePath: string, startLine: number, endLine: number, errorCodes?: ReadonlySet<number>): boolean
}

/**
 * Find the best-matching AST node for a given span in a TypeScript source file.
 *
 * When only start position is given, returns the smallest node containing that position.
 * When end position is also given, prefers the node whose span most closely matches
 * [start, end]. This is critical for expressions like `obj.method()` where tree-sitter
 * gives the span of the full call expression, but the smallest node at the start position
 * would be just the `obj` identifier.
 */
function getNodeAtPosition(
  sourceFile: ts.SourceFile,
  line: number,
  column: number,
  endLine?: number,
  endColumn?: number,
): ts.Node | undefined {
  let startPos: number
  let endPos: number | undefined
  try {
    startPos = ts.getPositionOfLineAndCharacter(sourceFile, line, column)
    if (endLine !== undefined && endColumn !== undefined) {
      endPos = ts.getPositionOfLineAndCharacter(sourceFile, endLine, endColumn)
    }
  } catch {
    return undefined
  }

  let candidate: ts.Node | undefined

  if (endPos !== undefined) {
    // Span-aware mode: find the node whose [start, end] most closely matches the requested span
    let bestScore = -Infinity

    function visitSpan(node: ts.Node) {
      const nodeStart = node.getStart(sourceFile)
      const nodeEnd = node.getEnd()
      if (nodeStart <= startPos && endPos! <= nodeEnd) {
        // Score prefers nodes that tightly wrap the requested span
        // Smaller excess span = higher score
        const excess = (startPos - nodeStart) + (nodeEnd - endPos!)
        const score = -excess
        if (score >= bestScore) {
          bestScore = score
          candidate = node
        }
        ts.forEachChild(node, visitSpan)
      }
    }

    visitSpan(sourceFile)
  } else {
    // Legacy mode: find smallest node containing the position
    function visit(node: ts.Node) {
      if (node.getStart(sourceFile) <= startPos && startPos < node.getEnd()) {
        candidate = node
        ts.forEachChild(node, visit)
      }
    }

    visit(sourceFile)
  }

  return candidate
}

/**
 * Create a TypeQueryService backed by a ts.Program and ts.TypeChecker.
 * The program is created once and kept alive so rule visitors can query types
 * during the AST walk.
 *
 * @param filePaths  Absolute paths to all TS/JS files to include
 * @param scopedOptions  Compiler options from buildScopedCompilerOptions()
 */
export function createTypeQueryService(
  filePaths: string[],
  scopedOptions: ScopedCompilerOptions[],
  repoPath: string,
): TypeQueryService {
  // Create one TS program per scoped option (per package) so that each file
  // gets its own tsconfig's paths, baseUrl, and module resolution settings.
  // A single global program fails because path aliases like @/* resolve
  // relative to each package's directory.
  interface ScopedProgram {
    program: ts.Program
    checker: ts.TypeChecker
    files: Set<string>
  }

  const scopedPrograms: ScopedProgram[] = []
  const fileToProgram = new Map<string, ScopedProgram>()

  // Group files by their matching scoped options
  const filesByScope = new Map<ScopedCompilerOptions, string[]>()
  const fallbackFiles: string[] = []

  for (const fp of filePaths) {
    const scope = scopedOptions.find((s) => fp.startsWith(s.dir + '/'))
    if (scope) {
      if (!filesByScope.has(scope)) filesByScope.set(scope, [])
      filesByScope.get(scope)!.push(fp)
    } else {
      fallbackFiles.push(fp)
    }
  }

  // Add fallback files to the last scope (root-level tsconfig)
  if (fallbackFiles.length > 0 && scopedOptions.length > 0) {
    const fallbackScope = scopedOptions[scopedOptions.length - 1]
    if (!filesByScope.has(fallbackScope)) filesByScope.set(fallbackScope, [])
    filesByScope.get(fallbackScope)!.push(...fallbackFiles)
  }

  for (const [scope, files] of filesByScope) {
    const options: ts.CompilerOptions = {
      ...scope.options,
      skipLibCheck: true,
      noEmit: true,
    }
    const host = createRepoScopedCompilerHost(repoPath, options)
    const program = ts.createProgram(files, options, host)
    const checker = program.getTypeChecker()
    const sp: ScopedProgram = { program, checker, files: new Set(files) }
    scopedPrograms.push(sp)
    for (const f of files) fileToProgram.set(f, sp)
  }

  // Fallback if no scoped options at all
  if (scopedPrograms.length === 0) {
    const options: ts.CompilerOptions = { skipLibCheck: true, noEmit: true }
    const host = createRepoScopedCompilerHost(repoPath, options)
    const program = ts.createProgram(filePaths, options, host)
    const checker = program.getTypeChecker()
    const sp: ScopedProgram = { program, checker, files: new Set(filePaths) }
    scopedPrograms.push(sp)
    for (const f of filePaths) fileToProgram.set(f, sp)
  }

  function getProgramForFile(filePath: string): ScopedProgram | undefined {
    return fileToProgram.get(filePath)
  }

  function getTypeAtNode(filePath: string, line: number, column: number, endLine?: number, endColumn?: number): ts.Type | null {
    const sp = getProgramForFile(filePath)
    if (!sp) return null
    const sf = sp.program.getSourceFile(filePath)
    if (!sf) return null
    const node = getNodeAtPosition(sf, line, column, endLine, endColumn)
    if (!node) return null
    try {
      return sp.checker.getTypeAtLocation(node)
    } catch {
      return null
    }
  }

  function getNodeForFile(filePath: string, line: number, column: number, endLine?: number, endColumn?: number): { node: ts.Node; checker: ts.TypeChecker } | null {
    const sp = getProgramForFile(filePath)
    if (!sp) return null
    const sf = sp.program.getSourceFile(filePath)
    if (!sf) return null
    const node = getNodeAtPosition(sf, line, column, endLine, endColumn)
    if (!node) return null
    return { node, checker: sp.checker }
  }

  function typeToString(filePath: string, type: ts.Type): string {
    const sp = getProgramForFile(filePath)
    return sp ? sp.checker.typeToString(type) : String(type)
  }

  return {
    getTypeAtPosition(filePath, line, column, endLine?, endColumn?) {
      const type = getTypeAtNode(filePath, line, column, endLine, endColumn)
      return type ? typeToString(filePath, type) : null
    },

    isPromiseLike(filePath, line, column, endLine?, endColumn?) {
      const type = getTypeAtNode(filePath, line, column, endLine, endColumn)
      if (!type) return false
      // Check string representation for Promise/PromiseLike
      const str = typeToString(filePath, type)
      if (str.startsWith('Promise<') || str.includes('PromiseLike<')) return true
      // Check if the type has a 'then' method (implements PromiseLike interface)
      // This catches thenables like drizzle-orm's PgRelationalQuery
      const thenProp = type.getProperty('then')
      if (thenProp) return true
      // A "value-or-promise" union (`Promise<T> | T`, often hidden behind
      // an alias like `CopyValue`) is a legitimate `await` target — the
      // promise branch unwraps and the value branch is a no-op. The
      // string-head check above misses it whenever the compiler
      // serializes the union with the non-promise branch first or whenever
      // the alias replaces the expansion entirely; recurse into the
      // union's constituent types so any promise-shaped member counts.
      if (type.isUnion()) {
        for (const t of type.types) {
          const s = typeToString(filePath, t)
          if (s.startsWith('Promise<') || s.includes('PromiseLike<')) return true
          if (t.getProperty('then')) return true
        }
      }
      return false
    },

    getReturnType(filePath, line, column, endLine?, endColumn?) {
      const result = getNodeForFile(filePath, line, column, endLine, endColumn)
      if (!result) return null
      try {
        const type = result.checker.getTypeAtLocation(result.node)
        const signatures = type.getCallSignatures()
        if (signatures.length === 0) return null
        const returnType = signatures[0].getReturnType()
        return typeToString(filePath, returnType)
      } catch {
        return null
      }
    },

    getTypeString(filePath, line, column, endLine?, endColumn?) {
      const type = getTypeAtNode(filePath, line, column, endLine, endColumn)
      return type ? typeToString(filePath, type) : null
    },

    isAnyType(filePath, line, column, endLine?, endColumn?) {
      const type = getTypeAtNode(filePath, line, column, endLine, endColumn)
      if (!type) return false
      return (type.flags & ts.TypeFlags.Any) !== 0
    },

    isAnyFromExternalSource(filePath, line, column, endLine?, endColumn?) {
      const result = getNodeForFile(filePath, line, column, endLine, endColumn)
      if (!result) return false
      return tracesAnyToExternalSource(result.checker, result.node, new Set())
    },

    isVoidType(filePath, line, column, endLine?, endColumn?) {
      const type = getTypeAtNode(filePath, line, column, endLine, endColumn)
      if (!type) return false
      return (type.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined)) !== 0
    },

    isBooleanType(filePath, line, column, endLine?, endColumn?) {
      const type = getTypeAtNode(filePath, line, column, endLine, endColumn)
      if (!type) return false
      return (type.flags & (ts.TypeFlags.Boolean | ts.TypeFlags.BooleanLiteral)) !== 0
    },

    isNumberType(filePath, line, column, endLine?, endColumn?) {
      const type = getTypeAtNode(filePath, line, column, endLine, endColumn)
      if (!type) return false
      return (type.flags & (ts.TypeFlags.Number | ts.TypeFlags.NumberLiteral)) !== 0
    },

    getParameterTypes(filePath, line, column, endLine?, endColumn?) {
      const result = getNodeForFile(filePath, line, column, endLine, endColumn)
      if (!result) return null
      try {
        const type = result.checker.getTypeAtLocation(result.node)
        const signatures = type.getCallSignatures()
        if (signatures.length === 0) return null
        return signatures[0].getParameters().map((param) => ({
          name: param.getName(),
          type: typeToString(filePath, result.checker.getTypeOfSymbolAtLocation(param, result.node)),
        }))
      } catch {
        return null
      }
    },

    areTypesCompatible(filePath, line1, col1, line2, col2) {
      const type1 = getTypeAtNode(filePath, line1, col1)
      const type2 = getTypeAtNode(filePath, line2, col2)
      if (!type1 || !type2) return false
      const sp = getProgramForFile(filePath)
      if (!sp) return false
      return sp.checker.isTypeAssignableTo(type1, type2) || sp.checker.isTypeAssignableTo(type2, type1)
    },

    hasTypeErrorInRange(filePath, startLine, endLine, errorCodes) {
      const sp = getProgramForFile(filePath)
      if (!sp) return false
      const sf = sp.program.getSourceFile(filePath)
      if (!sf) return false
      try {
        const diagnostics = sp.program.getSemanticDiagnostics(sf)
        for (const d of diagnostics) {
          if (d.start === undefined || d.file !== sf) continue
          if (errorCodes && !errorCodes.has(d.code)) continue
          const diagLine = sf.getLineAndCharacterOfPosition(d.start).line
          if (diagLine >= startLine && diagLine <= endLine) return true
        }
      } catch {
        // Skip — diagnostics unavailable
      }
      return false
    },
  }
}

// ---------------------------------------------------------------------------
// Any-source tracing
// ---------------------------------------------------------------------------

/**
 * Walk the symbol/initializer chain at `node` to determine whether the `any`
 * type at that position originates from an unresolved or external import.
 *
 * Returns true when the chain crosses an `import` declaration, a file in
 * `node_modules`, a `.d.ts` declaration file, or terminates at an unresolved
 * symbol. Returns false when an explicit `: any` annotation or `as any` cast
 * in user code is reached first — that's a real, intentional any and the
 * caller should still fire.
 *
 * Used by `unsafe-any-usage` (and other isAnyType-gated rules can opt in) to
 * suppress the FP storm produced when analyzing a target whose node_modules
 * isn't installed: `import { z } from 'zod'` makes every downstream
 * `SomeSchema.parse(...).foo` look any-typed, but the developer's code is
 * well-typed once the lib's `.d.ts` is present.
 */
function tracesAnyToExternalSource(
  checker: ts.TypeChecker,
  node: ts.Node,
  visited: Set<ts.Node>,
): boolean {
  if (visited.has(node)) return false
  visited.add(node)

  if (ts.isPropertyAccessExpression(node)) {
    return tracesAnyToExternalSource(checker, node.expression, visited)
  }
  if (ts.isElementAccessExpression(node)) {
    return tracesAnyToExternalSource(checker, node.expression, visited)
  }
  if (ts.isCallExpression(node)) {
    return tracesAnyToExternalSource(checker, node.expression, visited)
  }
  if (ts.isAsExpression(node)) {
    // `x as any` is an explicit cast — the any is intentional, not external.
    if (node.type.kind === ts.SyntaxKind.AnyKeyword) return false
    return tracesAnyToExternalSource(checker, node.expression, visited)
  }
  if (ts.isNonNullExpression(node) || ts.isParenthesizedExpression(node)) {
    return tracesAnyToExternalSource(checker, node.expression, visited)
  }
  if (ts.isAwaitExpression(node)) {
    return tracesAnyToExternalSource(checker, node.expression, visited)
  }

  if (!ts.isIdentifier(node)) {
    return false
  }

  const symbol = checker.getSymbolAtLocation(node)
  if (!symbol) return true

  const target = (symbol.flags & ts.SymbolFlags.Alias)
    ? safeGetAliasedSymbol(checker, symbol)
    : symbol
  if (!target || !target.declarations || target.declarations.length === 0) return true

  for (const decl of target.declarations) {
    const sf = decl.getSourceFile()
    if (sf.fileName.includes('/node_modules/')) return true
    if (sf.isDeclarationFile) return true

    // Declaration sits inside an import (specifier / clause / namespace) →
    // the originating value comes from another module.
    let ancestor: ts.Node | undefined = decl
    while (ancestor) {
      if (ts.isImportDeclaration(ancestor) || ts.isImportEqualsDeclaration(ancestor)) {
        return true
      }
      ancestor = ancestor.parent
    }

    if (ts.isBindingElement(decl)) {
      // Destructuring binding. Find the enclosing declaration the pattern
      // belongs to — either a `const { x } = expr` variable declaration or a
      // destructured function/callback parameter `({ x }) => ...`.
      let walker: ts.Node = decl
      while (
        walker.parent &&
        !ts.isVariableDeclaration(walker.parent) &&
        !ts.isParameter(walker.parent)
      ) {
        walker = walker.parent
      }
      const enclosing = walker.parent

      if (enclosing && ts.isParameter(enclosing)) {
        // Destructured parameter: `function Row({ envelope }: Props)`,
        // `render={({ field }) => ...}` (react-hook-form), `match(x).with(...)`
        // arms, etc. The binding is `any` either because the param's type
        // annotation is a TypeReference to an unresolved import (Props →
        // unresolved), or because the param is an untyped contextual callback
        // of an unresolved library generic. Both are external noise once
        // node_modules is absent. Only an explicit `: any` on the parameter
        // itself is developer-authored.
        if (enclosing.type && enclosing.type.kind === ts.SyntaxKind.AnyKeyword) return false
        return true
      }

      if (enclosing && ts.isVariableDeclaration(enclosing) && enclosing.initializer) {
        // `const { x } = expr` / `const [a] = expr` — recurse into the
        // initializer (e.g. `const { data } = useLoaderData()`).
        if (tracesAnyToExternalSource(checker, enclosing.initializer, visited)) {
          return true
        }
      }
      continue
    }

    if (ts.isVariableDeclaration(decl) || ts.isPropertyDeclaration(decl)) {
      if (decl.type && decl.type.kind === ts.SyntaxKind.AnyKeyword) return false
      if (decl.initializer) {
        if (
          ts.isAsExpression(decl.initializer) &&
          decl.initializer.type.kind === ts.SyntaxKind.AnyKeyword
        ) {
          return false
        }
        if (tracesAnyToExternalSource(checker, decl.initializer, visited)) {
          return true
        }
      }
      // No annotation, no `as any`, initializer didn't trace external →
      // probably a locally-inferred any (e.g. `let x; x = whatever()`). Leave
      // it to the caller; default to false here.
      continue
    }

    if (ts.isParameter(decl)) {
      // Explicit `(x: any)` is the intentional pattern the rule exists for.
      if (decl.type && decl.type.kind === ts.SyntaxKind.AnyKeyword) return false
      // Implicit-any parameters (no annotation, type inferred as `any`) are
      // overwhelmingly noise — JS files, contextual callbacks of unresolved
      // libraries, `noImplicitAny: false` configs. Treat as external so the
      // caller can suppress.
      return true
    }

    if (
      ts.isFunctionDeclaration(decl) ||
      ts.isMethodDeclaration(decl) ||
      ts.isArrowFunction(decl) ||
      ts.isFunctionExpression(decl)
    ) {
      // The identifier refers to a function whose return type is any. Without
      // an explicit `: any` return annotation, the any came from inference
      // (and most often from an external library).
      if (decl.type && decl.type.kind === ts.SyntaxKind.AnyKeyword) return false
      return true
    }
  }

  return false
}

function safeGetAliasedSymbol(checker: ts.TypeChecker, symbol: ts.Symbol): ts.Symbol | undefined {
  try {
    return checker.getAliasedSymbol(symbol)
  } catch {
    return undefined
  }
}

// ---------------------------------------------------------------------------
// JSX reference extraction
// ---------------------------------------------------------------------------

export interface JsxReference {
  /** The referenced identifier (function name or component name) */
  callee: string
  /** 0-indexed line number of the reference */
  line: number
  /** 0-indexed column */
  column: number
}

/**
 * Extract JSX references from a source file using the TypeScript compiler AST.
 * Returns identifiers referenced in JSX attributes (onClick={handler}) and
 * JSX component tags (<Child />, <Parent.Sub />).
 *
 * Uses ts.createSourceFile (lightweight, no program needed) for correct JSX
 * parsing — replaces tree-sitter heuristic matching on jsx_attribute /
 * jsx_self_closing_element node types.
 */
export function extractJsxReferences(
  sourceCode: string,
  filePath: string,
): JsxReference[] {
  const refs: JsxReference[] = []

  // Determine script kind from file extension
  const isTsx = filePath.endsWith('.tsx') || filePath.endsWith('.jsx')
  if (!isTsx) return refs // No JSX in .ts/.js files

  const sourceFile = ts.createSourceFile(
    filePath,
    sourceCode,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )

  function visit(node: ts.Node) {
    // JSX attribute with expression value: onClick={handleClick}
    if (ts.isJsxAttribute(node) && node.initializer && ts.isJsxExpression(node.initializer)) {
      const expr = node.initializer.expression
      if (expr) {
        if (ts.isIdentifier(expr)) {
          const pos = sourceFile.getLineAndCharacterOfPosition(expr.getStart(sourceFile))
          refs.push({ callee: expr.text, line: pos.line, column: pos.character })
        } else if (ts.isPropertyAccessExpression(expr)) {
          const pos = sourceFile.getLineAndCharacterOfPosition(expr.getStart(sourceFile))
          refs.push({ callee: expr.getText(sourceFile), line: pos.line, column: pos.character })
        }
      }
    }

    // JSX component tags: <Child /> or <Parent.Child />
    // Uppercase tags are user components, not HTML elements.
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tagName = node.tagName
      if (ts.isIdentifier(tagName) && /^[A-Z]/.test(tagName.text)) {
        const pos = sourceFile.getLineAndCharacterOfPosition(tagName.getStart(sourceFile))
        refs.push({ callee: tagName.text, line: pos.line, column: pos.character })
      } else if (ts.isPropertyAccessExpression(tagName)) {
        const text = tagName.getText(sourceFile)
        if (/^[A-Z]/.test(text)) {
          const pos = sourceFile.getLineAndCharacterOfPosition(tagName.getStart(sourceFile))
          refs.push({ callee: text, line: pos.line, column: pos.character })
        }
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return refs
}
