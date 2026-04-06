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
  /** Get the type of an expression at a position */
  getTypeAtPosition(filePath: string, line: number, column: number): string | null
  /** Check if a type is assignable to Promise */
  isPromiseLike(filePath: string, line: number, column: number): boolean
  /** Get return type of a function */
  getReturnType(filePath: string, line: number, column: number): string | null
  /** Get the type string for display */
  getTypeString(filePath: string, line: number, column: number): string | null
  /** Check if type is 'any' */
  isAnyType(filePath: string, line: number, column: number): boolean
  /** Check if type is void/undefined */
  isVoidType(filePath: string, line: number, column: number): boolean
  /** Check if type is boolean */
  isBooleanType(filePath: string, line: number, column: number): boolean
  /** Get parameter types of a function/method */
  getParameterTypes(filePath: string, line: number, column: number): Array<{ name: string; type: string }> | null
  /** Check if two positions have compatible types */
  areTypesCompatible(filePath: string, line1: number, col1: number, line2: number, col2: number): boolean
}

/**
 * Find the smallest AST node at the given 0-based line and column in a
 * TypeScript source file.
 */
function getNodeAtPosition(sourceFile: ts.SourceFile, line: number, column: number): ts.Node | undefined {
  let pos: number
  try {
    pos = ts.getPositionOfLineAndCharacter(sourceFile, line, column)
  } catch {
    return undefined
  }

  let candidate: ts.Node | undefined

  function visit(node: ts.Node) {
    if (node.getStart(sourceFile) <= pos && pos < node.getEnd()) {
      candidate = node
      ts.forEachChild(node, visit)
    }
  }

  visit(sourceFile)
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
  const baseOptions = scopedOptions[scopedOptions.length - 1]?.options ?? {}
  const options: ts.CompilerOptions = {
    ...baseOptions,
    skipLibCheck: true,
    noEmit: true,
  }

  const program = ts.createProgram(filePaths, options)
  const checker = program.getTypeChecker()

  function getTypeAtNode(filePath: string, line: number, column: number): ts.Type | null {
    const sf = program.getSourceFile(filePath)
    if (!sf) return null
    const node = getNodeAtPosition(sf, line, column)
    if (!node) return null
    try {
      return checker.getTypeAtLocation(node)
    } catch {
      return null
    }
  }

  function typeToString(type: ts.Type): string {
    return checker.typeToString(type)
  }

  return {
    getTypeAtPosition(filePath, line, column) {
      const type = getTypeAtNode(filePath, line, column)
      return type ? typeToString(type) : null
    },

    isPromiseLike(filePath, line, column) {
      const type = getTypeAtNode(filePath, line, column)
      if (!type) return false
      const str = typeToString(type)
      return str.startsWith('Promise<') || str.includes('PromiseLike<')
    },

    getReturnType(filePath, line, column) {
      const sf = program.getSourceFile(filePath)
      if (!sf) return null
      const node = getNodeAtPosition(sf, line, column)
      if (!node) return null
      try {
        const type = checker.getTypeAtLocation(node)
        const signatures = type.getCallSignatures()
        if (signatures.length === 0) return null
        const returnType = signatures[0].getReturnType()
        return typeToString(returnType)
      } catch {
        return null
      }
    },

    getTypeString(filePath, line, column) {
      const type = getTypeAtNode(filePath, line, column)
      return type ? typeToString(type) : null
    },

    isAnyType(filePath, line, column) {
      const type = getTypeAtNode(filePath, line, column)
      if (!type) return false
      return (type.flags & ts.TypeFlags.Any) !== 0
    },

    isVoidType(filePath, line, column) {
      const type = getTypeAtNode(filePath, line, column)
      if (!type) return false
      return (type.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined)) !== 0
    },

    isBooleanType(filePath, line, column) {
      const type = getTypeAtNode(filePath, line, column)
      if (!type) return false
      return (type.flags & (ts.TypeFlags.Boolean | ts.TypeFlags.BooleanLiteral)) !== 0
    },

    getParameterTypes(filePath, line, column) {
      const sf = program.getSourceFile(filePath)
      if (!sf) return null
      const node = getNodeAtPosition(sf, line, column)
      if (!node) return null
      try {
        const type = checker.getTypeAtLocation(node)
        const signatures = type.getCallSignatures()
        if (signatures.length === 0) return null
        return signatures[0].getParameters().map((param) => ({
          name: param.getName(),
          type: typeToString(checker.getTypeOfSymbolAtLocation(param, node)),
        }))
      } catch {
        return null
      }
    },

    areTypesCompatible(filePath, line1, col1, line2, col2) {
      const type1 = getTypeAtNode(filePath, line1, col1)
      const type2 = getTypeAtNode(filePath, line2, col2)
      if (!type1 || !type2) return false
      return checker.isTypeAssignableTo(type1, type2) || checker.isTypeAssignableTo(type2, type1)
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
