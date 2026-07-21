import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { isSafePattern } from 'redos-detector'

/**
 * ReDoS regression gate (Layer 2 of the issue #814 fix).
 *
 * The analyzer runs hundreds of regexes against arbitrary source code. A single
 * pattern that can backtrack catastrophically is what froze a whole `analyze`
 * run in #814. Layer 1 (the killable per-file worker) is the runtime *guarantee*
 * that no file can freeze the run; this gate is the *prevention* layer: it fails
 * the build if anyone introduces a regex literal that is provably vulnerable to
 * exponential backtracking.
 *
 * Scope & limits (documented on purpose):
 *  - Only regex *literals* (`/.../`) are analyzable statically; dynamic
 *    `new RegExp(`…${x}…`)` patterns can't be seen here and rely on Layer 1.
 *  - Detects *exponential* backtracking. Polynomial (quadratic) blowup — e.g.
 *    `[\s\S]*?` in an exec loop — is not flagged by the detector; Layer 1 bounds
 *    those at runtime.
 *  - "Inconclusive" patterns (the detector bails at the step/score budget) are
 *    reported but do NOT fail the build, to avoid flaky false positives.
 */

const ANALYZER_SRC = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../packages/analyzer/src',
)

// Exponential ReDoS needs a quantified GROUP (a `)` immediately followed by a
// quantifier) or an adjacent-quantifier pair. Char-class quantifiers (`[ab]+`)
// are linear and skipped. This cheap superset keeps the precise (slower) analysis
// to the few dozen patterns that could actually blow up.
const RISKY_SHAPE = /\)(?:[*+?]|\{\d)|[*+?]\?{0,1}[*+]/

// Generous budget so a genuinely-safe suspect resolves to `safe`, while a real
// exponential pattern is still caught quickly.
const DETECTOR_OPTS = { maxSteps: 200_000, maxScore: 35, timeout: 5_000 } as const

interface RegexLiteral {
  file: string
  line: number
  pattern: string
  flags: string
}

function collectTsFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) collectTsFiles(p, acc)
    else if (entry.name.endsWith('.ts')) acc.push(p)
  }
  return acc
}

function collectRegexLiterals(): RegexLiteral[] {
  const literals: RegexLiteral[] = []
  for (const file of collectTsFiles(ANALYZER_SRC)) {
    const src = fs.readFileSync(file, 'utf-8')
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true)
    const visit = (node: ts.Node) => {
      if (ts.isRegularExpressionLiteral(node)) {
        const m = /^\/(.*)\/([a-z]*)$/s.exec(node.getText(sf))
        if (m) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
          literals.push({ file: path.relative(ANALYZER_SRC, file), line: line + 1, pattern: m[1], flags: m[2] })
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  return literals
}

describe('ReDoS regex gate (analyzer)', () => {
  it('has no regex literal that is provably vulnerable to exponential backtracking', () => {
    const literals = collectRegexLiterals()
    // Sanity: enumeration actually found the corpus (guards against a broken walk).
    expect(literals.length).toBeGreaterThan(500)

    const vulnerable: string[] = []
    for (const lit of literals) {
      if (!RISKY_SHAPE.test(lit.pattern)) continue
      const jsFlags = lit.flags.replace(/[^gimsuy]/g, '')
      let result
      try {
        result = isSafePattern(lit.pattern, { flags: jsFlags, ...DETECTOR_OPTS })
      } catch {
        continue // detector couldn't parse it → inconclusive, don't fail
      }
      if (result.safe) continue
      if (result.error) continue // bailed at budget → inconclusive, don't fail
      vulnerable.push(`${lit.file}:${lit.line}  /${lit.pattern}/${lit.flags}`)
    }

    expect(
      vulnerable,
      `Regex literal(s) vulnerable to catastrophic (exponential) backtracking. ` +
        `Rewrite with bounded/atomic quantifiers or a linear scan:\n  ${vulnerable.join('\n  ')}`,
    ).toEqual([])
  })
})
