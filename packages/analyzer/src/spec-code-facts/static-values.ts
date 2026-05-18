import { dirname, resolve } from 'node:path'
import ts from 'typescript'
import type { SourceUnit } from './types.js'
import { normalizePath } from './utils.js'

type StaticValue = string | StaticObject

interface StaticObject {
  [key: string]: StaticValue
}

interface FileBindings {
  locals: Map<string, ts.Expression>
  exports: Map<string, ts.Expression>
  imports: Map<string, { targetFile: string; exportedName: string }>
}

export interface StaticValueResolver {
  resolveString(unit: SourceUnit, node: ts.Node | undefined): string | undefined
}

function unwrapExpression(node: ts.Node): ts.Node {
  let current = node
  while (
    ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isSatisfiesExpression(current)
    || ts.isParenthesizedExpression(current)
  ) {
    current = current.expression
  }
  return current
}

function propertyNameText(node: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return node.text
  return undefined
}

function importTargetFile(fromFile: string, specifier: string, files: Map<string, SourceUnit>): string | undefined {
  if (!specifier.startsWith('.')) return undefined

  const base = normalizePath(resolve(dirname(fromFile), specifier))
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.mts`,
    `${base}.cts`,
    `${base}.mjs`,
    `${base}.cjs`,
    normalizePath(resolve(base, 'index.ts')),
    normalizePath(resolve(base, 'index.tsx')),
    normalizePath(resolve(base, 'index.js')),
    normalizePath(resolve(base, 'index.jsx')),
  ]
  return candidates.find((candidate) => files.has(candidate))
}

function collectFileBindings(unit: SourceUnit, files: Map<string, SourceUnit>): FileBindings {
  const locals = new Map<string, ts.Expression>()
  const exports = new Map<string, ts.Expression>()
  const imports = new Map<string, { targetFile: string; exportedName: string }>()

  for (const statement of unit.ast.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const targetFile = importTargetFile(unit.absPath, statement.moduleSpecifier.text, files)
      const namedBindings = statement.importClause?.namedBindings
      if (targetFile && namedBindings && ts.isNamedImports(namedBindings)) {
        for (const element of namedBindings.elements) {
          imports.set(element.name.text, {
            targetFile,
            exportedName: (element.propertyName ?? element.name).text,
          })
        }
      }
      continue
    }

    if (!ts.isVariableStatement(statement)) continue
    if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) continue
    const isExported = statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue
      locals.set(declaration.name.text, declaration.initializer)
      if (isExported) exports.set(declaration.name.text, declaration.initializer)
    }
  }

  for (const statement of unit.ast.statements) {
    if (!ts.isExportDeclaration(statement) || !statement.exportClause || !ts.isNamedExports(statement.exportClause)) continue
    if (statement.moduleSpecifier) continue
    for (const element of statement.exportClause.elements) {
      const localName = (element.propertyName ?? element.name).text
      const local = locals.get(localName)
      if (local) exports.set(element.name.text, local)
    }
  }

  return { locals, exports, imports }
}

function propertyAccessParts(node: ts.Node): string[] | undefined {
  const unwrapped = unwrapExpression(node)
  if (ts.isIdentifier(unwrapped)) return [unwrapped.text]
  if (ts.isPropertyAccessExpression(unwrapped)) {
    const left = propertyAccessParts(unwrapped.expression)
    return left ? [...left, unwrapped.name.text] : undefined
  }
  if (ts.isElementAccessExpression(unwrapped)) {
    const left = propertyAccessParts(unwrapped.expression)
    const argument = unwrapExpression(unwrapped.argumentExpression)
    if (!left || !ts.isStringLiteralLike(argument)) return undefined
    return [...left, argument.text]
  }
  return undefined
}

export function createStaticValueResolver(sourceUnits: SourceUnit[]): StaticValueResolver {
  const files = new Map(sourceUnits.map((unit) => [normalizePath(resolve(unit.absPath)), unit]))
  const bindings = new Map<string, FileBindings>()
  for (const unit of sourceUnits) {
    bindings.set(normalizePath(resolve(unit.absPath)), collectFileBindings(unit, files))
  }

  const resolveIdentifier = (file: string, name: string, seen: Set<string>): StaticValue | undefined => {
    const fileBindings = bindings.get(file)
    if (!fileBindings) return undefined

    const imported = fileBindings.imports.get(name)
    if (imported) {
      const key = `${imported.targetFile}:${imported.exportedName}`
      if (seen.has(key)) return undefined
      seen.add(key)
      const targetBindings = bindings.get(imported.targetFile)
      const exported = targetBindings?.exports.get(imported.exportedName)
      return exported ? resolveValue(imported.targetFile, exported, seen) : undefined
    }

    const key = `${file}:${name}`
    if (seen.has(key)) return undefined
    const local = fileBindings.locals.get(name)
    if (!local) return undefined
    seen.add(key)
    return resolveValue(file, local, seen)
  }

  const resolveValue = (file: string, node: ts.Node | undefined, seen: Set<string>): StaticValue | undefined => {
    if (!node) return undefined
    const unwrapped = unwrapExpression(node)

    if (ts.isStringLiteralLike(unwrapped) || ts.isNoSubstitutionTemplateLiteral(unwrapped)) return unwrapped.text

    if (ts.isIdentifier(unwrapped)) return resolveIdentifier(file, unwrapped.text, seen)

    if (ts.isObjectLiteralExpression(unwrapped)) {
      const value: Record<string, StaticValue> = {}
      for (const property of unwrapped.properties) {
        if (!ts.isPropertyAssignment(property)) return undefined
        const name = propertyNameText(property.name)
        if (!name) return undefined
        const propertyValue = resolveValue(file, property.initializer, new Set(seen))
        if (propertyValue !== undefined) value[name] = propertyValue
      }
      return value
    }

    const parts = propertyAccessParts(unwrapped)
    if (parts && parts.length > 1) {
      let value = resolveIdentifier(file, parts[0]!, seen)
      for (const part of parts.slice(1)) {
        if (typeof value !== 'object' || value === null) return undefined
        value = value[part]
      }
      return value
    }

    return undefined
  }

  return {
    resolveString(unit, node) {
      const value = resolveValue(normalizePath(resolve(unit.absPath)), node, new Set())
      return typeof value === 'string' ? value : undefined
    },
  }
}
