import { readFileSync } from 'node:fs'
import { basename, extname, resolve } from 'node:path'
import ts from 'typescript'
import {
  SPEC_COMPLIANCE_CODE_FACT_SCHEMA_VERSION,
  canonicalJson,
  type CodeFact,
} from '@truecourse/shared'
import { extractAuthFacts } from './spec-code-facts/auth.js'
import { discoverCodeFactInputs } from './spec-code-facts/discovery.js'
import { extractEnvFacts } from './spec-code-facts/env.js'
import { emitExpressFacts } from './spec-code-facts/express.js'
import { extractJsxFacts } from './spec-code-facts/jsx.js'
import { SPEC_CODE_FACT_EXTRACTORS } from './spec-code-facts/metadata.js'
import { extractInfraConfigFacts } from './spec-code-facts/infra-config.js'
import { extractPackageFacts } from './spec-code-facts/package-manifest.js'
import { extractReactRouteFacts } from './spec-code-facts/react-router.js'
import { extractSchemaFacts } from './spec-code-facts/schema.js'
import { createStaticValueResolver } from './spec-code-facts/static-values.js'
import { extractTestFacts } from './spec-code-facts/test-hints.js'
import type {
  CodeFactExtractionError,
  CodeFactExtractionResult,
  SourceUnit,
} from './spec-code-facts/types.js'
import { normalizePath, repoRelativePath, scriptKindFor } from './spec-code-facts/utils.js'

function extractFromSourceUnit(unit: SourceUnit, resolver: ReturnType<typeof createStaticValueResolver>): void {
  extractEnvFacts(unit)
  extractAuthFacts(unit)
  extractReactRouteFacts(unit, resolver)
  extractJsxFacts(unit, resolver)
  extractTestFacts(unit)
}

export async function extractCodeFacts(rootDir: string): Promise<CodeFactExtractionResult> {
  const resolvedRoot = resolve(rootDir)
  const facts: CodeFact[] = []
  const errors: CodeFactExtractionError[] = []
  const files = discoverCodeFactInputs(resolvedRoot)
  const knownFiles = new Set(files.map((file) => normalizePath(resolve(file))))
  const sourceUnits: SourceUnit[] = []

  for (const absPath of files) {
    const sourceFile = repoRelativePath(resolvedRoot, absPath)

    if (basename(absPath) === 'package.json') {
      const result = extractPackageFacts(resolvedRoot, absPath)
      facts.push(...result.facts)
      errors.push(...result.errors)
      continue
    }

    let content: string
    try {
      content = readFileSync(absPath, 'utf8')
    } catch (error) {
      errors.push({ sourceFile, message: error instanceof Error ? error.message : String(error) })
      continue
    }

    try {
      extractSchemaFacts(sourceFile, content, facts)
      extractInfraConfigFacts(sourceFile, content, facts)
    } catch (error) {
      errors.push({ sourceFile, message: error instanceof Error ? error.message : String(error) })
    }

    if (!['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'].includes(extname(absPath).toLowerCase())) {
      continue
    }

    const ast = ts.createSourceFile(absPath, content, ts.ScriptTarget.Latest, true, scriptKindFor(absPath))
    const parseDiagnostics = (ast as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? []
    if (parseDiagnostics.length > 0) {
      errors.push({ sourceFile, message: parseDiagnostics[0]?.messageText.toString() ?? 'Parse failure' })
      continue
    }

    sourceUnits.push({ absPath, sourceFile, content, ast, facts: [], errors: [] })
  }

  emitExpressFacts(sourceUnits, knownFiles)
  const staticValueResolver = createStaticValueResolver(sourceUnits)
  for (const unit of sourceUnits) {
    try {
      extractFromSourceUnit(unit, staticValueResolver)
    } catch (error) {
      unit.errors.push({ sourceFile: unit.sourceFile, message: error instanceof Error ? error.message : String(error) })
    }
    facts.push(...unit.facts)
    errors.push(...unit.errors)
  }

  const uniqueFacts = new Map<string, CodeFact>()
  for (const fact of facts) uniqueFacts.set(fact.id, fact)
  return {
    facts: [...uniqueFacts.values()].sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b))),
    errors: errors.sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b))),
  }
}

export { SPEC_CODE_FACT_EXTRACTORS, SPEC_COMPLIANCE_CODE_FACT_SCHEMA_VERSION }
export type { CodeFactExtractionError, CodeFactExtractionResult }
