import { createHash } from 'node:crypto'
import path from 'node:path'
import ts from 'typescript'
import { readHint, sourceLines, sourceView, type SourcePosition, type SourceRange } from '../agent/source-view.js'

export interface SourceUnit {
  readonly start: number
  readonly end: number
  readonly name: string
  readonly kind: 'import' | 'declaration' | 'statement'
}
export interface SourceEvidence {
  readonly hash: string
  readonly parsed: boolean
  readonly units: readonly SourceUnit[]
  /** Import specifiers only. These are source facts, not inferred runtime contracts. */
  readonly imports: readonly string[]
}
// Reuse structural source facts across place/cluster packs. Hash the actual source,
// not its timestamp: two clones and same-size edits must receive correct evidence.
const evidenceCache = new Map<string, { evidence: SourceEvidence; bytes: number }>()
const MAX_EVIDENCE_CACHE_ENTRIES = 256
const MAX_EVIDENCE_CACHE_BYTES = 16_000_000
let evidenceCacheBytes = 0

export function sourceEvidence(file: string, source: string): SourceEvidence {
  const hash = createHash('sha256').update(source).digest('hex')
  const extension = path.extname(file).toLowerCase()
  const key = `${extension}:${hash}`
  const cached = evidenceCache.get(key)
  if (cached) {
    evidenceCache.delete(key)
    evidenceCache.set(key, cached)
    return cached.evidence
  }
  const units: SourceUnit[] = []
  const imports: string[] = []
  let parsed = false
  try {
    if (/^\.[cm]?[jt]sx?$/.test(extension)) {
      const ast = ts.createSourceFile(`source${extension}`, source, ts.ScriptTarget.Latest, true)
      // Parse failures cannot establish declaration boundaries safely. The caller
      // supplies an ordinary recoverable page instead and labels it partial.
      const diagnostics = (ast as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics
      parsed = diagnostics.length === 0
      if (parsed) {
        for (const statement of ast.statements) {
          const firstComment = ts.getLeadingCommentRanges(source, statement.getFullStart())?.[0]
          const start = ast.getLineAndCharacterOfPosition(firstComment?.pos ?? statement.getStart(ast)).line + 1
          const end = ast.getLineAndCharacterOfPosition(statement.end).line + 1
          let name = ts.SyntaxKind[statement.kind]
          const named = statement as ts.Statement & { name?: ts.Node }
          if (named.name) name = named.name.getText(ast)
          if (ts.isVariableStatement(statement)) name = statement.declarationList.declarations.map(d => d.name.getText(ast)).join(', ')
          const isImport = ts.isImportDeclaration(statement) || ts.isImportEqualsDeclaration(statement)
          if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) imports.push(statement.moduleSpecifier.text)
          const kind = isImport ? 'import' : ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isVariableStatement(statement) ? 'declaration' : 'statement'
          // Statements sharing a line form one indivisible source unit. Including
          // the entire line never claims completeness for only part of that line.
          const previous = units.at(-1)
          if (previous && start <= previous.end) {
            units[units.length - 1] = { start: previous.start, end, name: `${previous.name}, ${name}`, kind: previous.kind === kind ? kind : 'statement' }
          } else units.push({ start, end, name, kind })
        }
      }
    }
  } catch {
    // An adversarially nested file can exhaust the parser stack. It is still
    // readable as source pages; no structural evidence is asserted for it.
    parsed = false
    units.length = 0
    imports.length = 0
  }
  const evidence: SourceEvidence = Object.freeze({ hash, parsed,
    units: Object.freeze(units.map(unit => Object.freeze(unit))), imports: Object.freeze(imports) })
  const bytes = Buffer.byteLength(JSON.stringify(evidence))
  if (bytes <= MAX_EVIDENCE_CACHE_BYTES) {
    evidenceCache.set(key, { evidence, bytes })
    evidenceCacheBytes += bytes
    while (evidenceCache.size > MAX_EVIDENCE_CACHE_ENTRIES || evidenceCacheBytes > MAX_EVIDENCE_CACHE_BYTES) {
      const oldest = evidenceCache.keys().next().value!
      evidenceCacheBytes -= evidenceCache.get(oldest)!.bytes
      evidenceCache.delete(oldest)
    }
  }
  return evidence
}

export interface SourceGap { start: SourcePosition; end: SourcePosition }

/** Exact complement of the supplied source ranges, including partially read lines. */
export function omittedSourceRanges(lines: readonly string[], ranges: readonly SourceRange[]): SourceGap[] {
  const gaps: SourceGap[] = []
  let cursor: SourcePosition = { start: 1, startColumn: 1 }
  for (const range of ranges) {
    if (range.line > cursor.start || range.startColumn > cursor.startColumn) {
      gaps.push({ start: cursor, end: { start: range.line, startColumn: range.startColumn } })
    }
    cursor = range.endColumn === Array.from(lines[range.line - 1]).length + 1
      ? { start: range.line + 1, startColumn: 1 }
      : { start: range.line, startColumn: range.endColumn }
  }
  if (cursor.start <= lines.length) gaps.push({ start: cursor, end: { start: lines.length + 1, startColumn: 1 } })
  return gaps
}

/** Whole declarations are preferred to arbitrary prefixes; oversized units remain named and recoverable. */
export function sourceUnitView(file: string, source: string, maxBytes: number) {
  const evidence = sourceEvidence(file, source)
  const lines = sourceLines(source)
  const hashLine = `Source SHA-256: ${evidence.hash}\n`
  const page = sourceView({ path: file, lines, maxLines: lines.length, maxBytes: maxBytes - Buffer.byteLength(hashLine) })
  if (page.complete || !evidence.parsed || !evidence.units.length || maxBytes < 2_000) {
    return { ...page, content: hashLine + page.content, hash: evidence.hash, omitted: omittedSourceRanges(lines, page.ranges), units: [] as SourceUnit[] }
  }
  let remaining = maxBytes - Buffer.byteLength(hashLine) - 1_200 - Buffer.byteLength(file) * 2
  const selected: SourceUnit[] = []
  // Prefer complete behavior-bearing declarations; imports and other statements
  // fill the remaining budget. The original order is restored for presentation.
  for (const unit of [...evidence.units].sort((a, b) => Number(b.kind === 'declaration') - Number(a.kind === 'declaration') || a.start - b.start)) {
    const size = Buffer.byteLength(lines.slice(unit.start - 1, unit.end).map((line, i) => `${unit.start + i}\t${line}`).join('\n')) + 2
    if (size > remaining) continue
    selected.push(unit)
    remaining -= size
  }
  if (!selected.length) return { ...page, content: hashLine + page.content, hash: evidence.hash, omitted: omittedSourceRanges(lines, page.ranges), units: [] as SourceUnit[] }
  selected.sort((a, b) => a.start - b.start)
  const ranges = selected.flatMap(unit => lines.slice(unit.start - 1, unit.end).map((line, i) => ({ line: unit.start + i, startColumn: 1, endColumn: Array.from(line).length + 1 })))
  const omitted = omittedSourceRanges(lines, ranges)
  const blocks = selected.map(unit => lines.slice(unit.start - 1, unit.end).map((line, i) => `${unit.start + i}\t${line}`).join('\n'))
  const missingUnits = evidence.units.filter(unit => !selected.includes(unit))
  const unitRows: string[] = []
  let indexBytes = 0
  for (const unit of missingUnits) {
    const row = JSON.stringify({ name: unit.name, start: unit.start, end: unit.end })
    if (indexBytes + Buffer.byteLength(row) > 600) break
    unitRows.push(row); indexBytes += Buffer.byteLength(row)
  }
  const content = hashLine + `${file} (${lines.length} lines). Complete source units; this is NOT the whole file. Dependencies and omitted declarations still require inspection.\n` + blocks.join('\n\n') +
    `\nOmitted declarations: ${missingUnits.length}. ${unitRows.join(' ')}${unitRows.length < missingUnits.length ? ' Index incomplete; retrieve remaining source.' : ''}` +
    `\nPartial source. Continue with ${readHint(file, omitted[0]?.start ?? { start: 1, startColumn: 1 })}`
  // Pathological metadata cannot violate the budget or lose recoverability.
  if (Buffer.byteLength(content) > maxBytes) return { ...page, content: hashLine + page.content, hash: evidence.hash, omitted: omittedSourceRanges(lines, page.ranges), units: [] as SourceUnit[] }
  return { content, hash: evidence.hash, complete: omitted.length === 0, ranges, omitted, units: selected, ...(omitted[0] ? { next: omitted[0].start } : {}) }
}
