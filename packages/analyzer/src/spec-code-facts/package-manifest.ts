import { readFileSync } from 'node:fs'
import ts from 'typescript'
import type { CodeFact } from '@truecourse/shared'
import { EXTRACTORS } from './metadata.js'
import type { CodeFactExtractionError } from './types.js'
import { jsonRangeOf, pushFact, repoRelativePath, stringLiteralValue, textOfName } from './utils.js'

export function extractPackageFacts(rootDir: string, absPath: string): { facts: CodeFact[]; errors: CodeFactExtractionError[] } {
  const sourceFile = repoRelativePath(rootDir, absPath)
  const facts: CodeFact[] = []
  const errors: CodeFactExtractionError[] = []
  let content: string
  try {
    content = readFileSync(absPath, 'utf8')
  } catch (error) {
    errors.push({ sourceFile, extractor: EXTRACTORS.packageManifest, message: error instanceof Error ? error.message : String(error) })
    return { facts, errors }
  }

  const ast = ts.parseJsonText(absPath, content)
  const parseDiagnostics = (ast as ts.JsonSourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? []
  if (parseDiagnostics.length > 0) {
    errors.push({ sourceFile, extractor: EXTRACTORS.packageManifest, message: parseDiagnostics[0]?.messageText.toString() ?? 'Malformed package.json' })
    return { facts, errors }
  }

  const root = ast.statements[0]?.expression
  if (!root || !ts.isObjectLiteralExpression(root)) return { facts, errors }

  const readProperty = (object: ts.ObjectLiteralExpression, name: string): ts.PropertyAssignment | undefined => {
    return object.properties.find((prop): prop is ts.PropertyAssignment => (
      ts.isPropertyAssignment(prop) && textOfName(prop.name) === name
    ))
  }

  const readString = (name: string): string | undefined => {
    const prop = readProperty(root, name)
    return prop ? stringLiteralValue(prop.initializer) : undefined
  }

  const readBoolean = (name: string): boolean | undefined => {
    const prop = readProperty(root, name)
    if (!prop) return undefined
    if (prop.initializer.kind === ts.SyntaxKind.TrueKeyword) return true
    if (prop.initializer.kind === ts.SyntaxKind.FalseKeyword) return false
    return undefined
  }

  const objectKeys = (name: string): string[] => {
    const prop = readProperty(root, name)
    if (!prop || !ts.isObjectLiteralExpression(prop.initializer)) return []
    return prop.initializer.properties
      .map((child) => ts.isPropertyAssignment(child) ? textOfName(child.name) : undefined)
      .filter((value): value is string => Boolean(value))
      .sort()
  }

  const packageName = readString('name')
  const binProp = readProperty(root, 'bin')
  if (binProp) {
    const emitBinary = (name: string, entry?: string, rangeNode: ts.Node = binProp): void => {
      pushFact(
        facts,
        sourceFile,
        jsonRangeOf(ast, rangeNode),
        'cli.binary',
        'binary.defined',
        { name, ...(entry ? { entry } : {}), ...(packageName ? { packageName } : {}) },
        EXTRACTORS.packageCli,
      )
    }

    const binString = stringLiteralValue(binProp.initializer)
    if (binString && packageName) {
      emitBinary(packageName.startsWith('@') ? packageName.split('/').pop() ?? packageName : packageName, binString)
    } else if (ts.isObjectLiteralExpression(binProp.initializer)) {
      for (const prop of binProp.initializer.properties) {
        if (!ts.isPropertyAssignment(prop)) continue
        const name = textOfName(prop.name)
        const entry = stringLiteralValue(prop.initializer)
        if (name) emitBinary(name, entry, prop)
      }
    }
  }

  const scriptsProp = readProperty(root, 'scripts')
  if (scriptsProp && ts.isObjectLiteralExpression(scriptsProp.initializer)) {
    for (const prop of scriptsProp.initializer.properties) {
      if (!ts.isPropertyAssignment(prop)) continue
      const script = textOfName(prop.name)
      const command = stringLiteralValue(prop.initializer)
      if (!script || !command) continue
      pushFact(
        facts,
        sourceFile,
        jsonRangeOf(ast, prop),
        'package.script',
        'script.defined',
        { ...(packageName ? { packageName } : {}), script, command },
        EXTRACTORS.packageManifest,
      )
    }
  }

  pushFact(
    facts,
    sourceFile,
    jsonRangeOf(ast, root),
    'package.metadata',
    'manifest.exists',
    {
      ...(packageName ? { name: packageName } : {}),
      ...(readString('version') ? { version: readString('version') } : {}),
      ...(readBoolean('private') !== undefined ? { private: readBoolean('private') } : {}),
      dependencies: objectKeys('dependencies'),
      devDependencies: objectKeys('devDependencies'),
    },
    EXTRACTORS.packageManifest,
  )

  return { facts, errors }
}
