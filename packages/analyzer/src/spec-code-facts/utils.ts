import { extname, relative } from 'node:path'
import ts from 'typescript'
import {
  CodeFactSchema,
  createCodeFactId,
  type CodeFact,
  type ExtractorMetadata,
  type SourceRange,
} from '@truecourse/shared'

export function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/')
}

export function repoRelativePath(rootDir: string, filePath: string): string {
  return normalizePath(relative(rootDir, filePath))
}

export function rangeOf(sourceFile: ts.SourceFile, node: ts.Node): SourceRange {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1
  return { startLine: start, endLine: end }
}

export function jsonRangeOf(sourceFile: ts.JsonSourceFile, node: ts.Node): SourceRange {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1
  return { startLine: start, endLine: end }
}

export function pushFact(
  facts: CodeFact[],
  sourceFile: string,
  sourceRange: SourceRange | undefined,
  kind: string,
  predicate: string,
  value: unknown,
  extractor: ExtractorMetadata,
): void {
  const candidate = {
    id: createCodeFactId({
      sourceFile,
      sourceRange,
      kind,
      predicate,
      value,
      extractorVersion: extractor.version,
    }),
    sourceFile,
    ...(sourceRange ? { sourceRange } : {}),
    kind,
    predicate,
    value,
    confidence: 1,
    extractor,
  }

  const parsed = CodeFactSchema.safeParse(candidate)
  if (parsed.success) facts.push(parsed.data)
}

export function scriptKindFor(filePath: string): ts.ScriptKind {
  switch (extname(filePath).toLowerCase()) {
    case '.tsx':
      return ts.ScriptKind.TSX
    case '.jsx':
      return ts.ScriptKind.JSX
    case '.js':
    case '.mjs':
    case '.cjs':
      return ts.ScriptKind.JS
    default:
      return ts.ScriptKind.TS
  }
}

export function textOfName(node: ts.Node | undefined): string | undefined {
  if (!node) return undefined
  if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) return node.text
  if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return node.text
  return undefined
}

export function stringLiteralValue(node: ts.Node | undefined): string | undefined {
  if (!node) return undefined
  if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  return undefined
}

export function expressionName(node: ts.Expression | undefined): string | undefined {
  if (!node) return undefined
  if (ts.isIdentifier(node)) return node.text
  if (ts.isPropertyAccessExpression(node)) return node.name.text
  if (ts.isCallExpression(node)) return expressionName(node.expression)
  if (ts.isArrayLiteralExpression(node)) return 'array'
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return node.name?.text
  return undefined
}

export function calleeParts(node: ts.Expression): string[] {
  if (ts.isIdentifier(node)) return [node.text]
  if (ts.isPropertyAccessExpression(node)) return [...calleeParts(node.expression), node.name.text]
  return []
}

export function joinRoutePath(prefix: string, path: string): string {
  if (!prefix || prefix === '/') return path.startsWith('/') ? path : `/${path}`
  const left = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix
  const right = path.startsWith('/') ? path : `/${path}`
  return `${left}${right}`.replace(/\/+/g, '/')
}
