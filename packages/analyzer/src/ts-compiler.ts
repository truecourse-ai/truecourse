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
      for (const entry of readdirSync(dirPath)) {
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
): SemanticAnalysisResult {
  const baseOptions = scoped[scoped.length - 1]?.options ?? {}
  const options: ts.CompilerOptions = {
    ...baseOptions,
    skipLibCheck: true,
    noEmit: true,
  }

  const program = ts.createProgram(filePaths, options)
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
  /** Check if the TS compiler reports a type error in a line range */
  hasTypeErrorInRange(filePath: string, startLine: number, endLine: number): boolean
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
    const program = ts.createProgram(files, options)
    const checker = program.getTypeChecker()
    const sp: ScopedProgram = { program, checker, files: new Set(files) }
    scopedPrograms.push(sp)
    for (const f of files) fileToProgram.set(f, sp)
  }

  // Fallback if no scoped options at all
  if (scopedPrograms.length === 0) {
    const program = ts.createProgram(filePaths, { skipLibCheck: true, noEmit: true })
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
      return !!thenProp
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

    hasTypeErrorInRange(filePath, startLine, endLine) {
      const sp = getProgramForFile(filePath)
      if (!sp) return false
      const sf = sp.program.getSourceFile(filePath)
      if (!sf) return false
      try {
        const diagnostics = sp.program.getSemanticDiagnostics(sf)
        for (const d of diagnostics) {
          if (d.start === undefined || d.file !== sf) continue
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
