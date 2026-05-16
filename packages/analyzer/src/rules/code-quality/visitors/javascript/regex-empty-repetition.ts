import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getRegexSource } from './_helpers.js'

export const regexEmptyRepetitionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/regex-empty-repetition',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['regex', 'new_expression'],
  visit(node, filePath, sourceCode) {
    const src = getRegexSource(node)
    if (!src) return null

    if (hasEmptyRepetition(src)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Empty string repetition in regex',
        'Repeated group can match an empty string, which may cause catastrophic backtracking.',
        sourceCode,
        'Restructure the regex to avoid nested quantifiers on patterns that can match empty strings.',
      )
    }
    return null
  },
}

// Find groups followed by a repetition quantifier (*, +, {n,m} with n=0)
// whose body can match an empty string (is "nullable").
function hasEmptyRepetition(src: string): boolean {
  // Find every top-level group span (its inner-body range), then check if the
  // following character(s) is a "repetition" quantifier and the body is nullable.
  const len = src.length
  let i = 0
  while (i < len) {
    const ch = src[i]
    if (ch === '\\') { i += 2; continue }
    if (ch === '[') {
      // skip character class
      i++
      while (i < len) {
        const c = src[i]
        if (c === '\\') { i += 2; continue }
        if (c === ']') { i++; break }
        i++
      }
      continue
    }
    if (ch === '(') {
      // Skip group-head (e.g. ?:, ?=, ?!, ?<=, ?<!, ?<name>) — body starts after.
      let bodyStart = i + 1
      if (src[bodyStart] === '?') {
        // non-capturing/lookaround/named — skip until end of head
        const head = src.slice(bodyStart)
        const m = head.match(/^\?(?::|=|!|<=|<!|<[^>]+>)/)
        if (m) bodyStart += m[0].length
      }
      // find matching close paren, tracking nesting and char classes/escapes
      let depth = 1
      let j = bodyStart
      while (j < len && depth > 0) {
        const c = src[j]
        if (c === '\\') { j += 2; continue }
        if (c === '[') {
          j++
          while (j < len) {
            const cc = src[j]
            if (cc === '\\') { j += 2; continue }
            if (cc === ']') { j++; break }
            j++
          }
          continue
        }
        if (c === '(') depth++
        else if (c === ')') {
          depth--
          if (depth === 0) break
        }
        j++
      }
      if (depth !== 0) return false // unbalanced; bail
      const bodyEnd = j // index of matching `)`
      const body = src.slice(bodyStart, bodyEnd)
      const afterClose = bodyEnd + 1
      const q = parseQuantifier(src, afterClose)
      if (q && q.minZero && isNullable(body)) return true
      // advance past `)` and continue scanning. We still want to recurse into body
      // so the outer loop will catch nested groups — but body is already part of src,
      // so the outer scan will revisit it. Just advance one past `(`.
      i++
      continue
    }
    i++
  }
  return false
}

// Returns { minZero } if src[idx..] starts with a "repetition" quantifier
// that allows zero matches (*, ?, {0,...}, {0}). `?` is included because /(?:foo)?/
// can match empty — but `?` is not catastrophic-backtracking-prone. The classic
// "empty repetition" bug per ESLint `no-empty-repetition` flags *, +, {n,} on
// nullable groups. We only flag `*` and `+` and `{0,...}` / `{n,}` where
// repetition is unbounded — `?` is excluded.
function parseQuantifier(src: string, idx: number): { minZero: boolean } | null {
  const c = src[idx]
  if (c === '*') return { minZero: true }
  if (c === '+') return { minZero: true }
  if (c === '{') {
    // Parse {n}, {n,}, {n,m}
    const m = src.slice(idx).match(/^\{(\d+)(?:,(\d*))?\}/)
    if (!m) return null
    const max = m[2] === undefined ? Number(m[1]) : m[2] === '' ? Infinity : Number(m[2])
    // Repetition is meaningful (>=2 matches possible) iff max >= 2.
    if (max >= 2) return { minZero: true }
    return null
  }
  return null
}

// Determine whether a regex body (inside a group, no surrounding `(` `)`)
// can match the empty string.
function isNullable(body: string): boolean {
  if (body.length === 0) return true
  // Split body at top-level alternation
  const alts = splitTopLevelAlternatives(body)
  if (alts.length > 1) {
    return alts.some((alt) => isNullable(alt))
  }
  // Single alternative: concatenation of atoms — nullable iff every atom is nullable.
  const atoms = parseAtoms(body)
  if (atoms === null) {
    // parse error / unsupported construct — conservatively non-nullable
    return false
  }
  return atoms.every((a) => a.nullable)
}

function splitTopLevelAlternatives(body: string): string[] {
  const out: string[] = []
  let depth = 0
  let inClass = false
  let start = 0
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (c === '\\') { i++; continue }
    if (inClass) {
      if (c === ']') inClass = false
      continue
    }
    if (c === '[') { inClass = true; continue }
    if (c === '(') depth++
    else if (c === ')') depth--
    else if (c === '|' && depth === 0) {
      out.push(body.slice(start, i))
      start = i + 1
    }
  }
  out.push(body.slice(start))
  return out
}

type Atom = { nullable: boolean }

function parseAtoms(body: string): Atom[] | null {
  const atoms: Atom[] = []
  let i = 0
  const len = body.length
  while (i < len) {
    const ch = body[i]
    // Anchors and zero-width assertions are nullable (^, $, \b, \B)
    if (ch === '^' || ch === '$') {
      atoms.push({ nullable: true })
      i++
      continue
    }
    if (ch === '\\') {
      // escape sequence — usually consumes one input char (e.g. \d, \w, \., \n, \1)
      // Word-boundary \b, \B are zero-width assertions → nullable
      const next = body[i + 1]
      if (next === 'b' || next === 'B') {
        atoms.push({ nullable: true })
        i += 2
      } else {
        const q = readQuantifier(body, i + 2)
        atoms.push({ nullable: q.nullable })
        i = q.next
      }
      continue
    }
    if (ch === '[') {
      // character class — consumes one input char (never nullable on its own)
      let j = i + 1
      while (j < len) {
        const c = body[j]
        if (c === '\\') { j += 2; continue }
        if (c === ']') { j++; break }
        j++
      }
      const q = readQuantifier(body, j)
      atoms.push({ nullable: q.nullable })
      i = q.next
      continue
    }
    if (ch === '(') {
      // Group — find matching `)`
      const bodyStart = i + 1
      let head = ''
      let actualStart = bodyStart
      if (body[bodyStart] === '?') {
        const m = body.slice(bodyStart).match(/^\?(?::|=|!|<=|<!|<[^>]+>)/)
        if (m) {
          head = m[0]
          actualStart = bodyStart + head.length
        }
      }
      let depth = 1
      let j = actualStart
      while (j < len && depth > 0) {
        const c = body[j]
        if (c === '\\') { j += 2; continue }
        if (c === '[') {
          j++
          while (j < len) {
            const cc = body[j]
            if (cc === '\\') { j += 2; continue }
            if (cc === ']') { j++; break }
            j++
          }
          continue
        }
        if (c === '(') depth++
        else if (c === ')') {
          depth--
          if (depth === 0) break
        }
        j++
      }
      if (depth !== 0) return null
      const innerBody = body.slice(actualStart, j)
      const closeIdx = j + 1
      // Lookarounds (?=, ?!, ?<=, ?<!) are zero-width → always nullable atoms
      const isLookaround = head === '?=' || head === '?!' || head === '?<=' || head === '?<!'
      const innerNullable = isLookaround ? true : isNullable(innerBody)
      const q = readQuantifier(body, closeIdx)
      // Atom is nullable if base is nullable OR quantifier permits zero matches.
      atoms.push({ nullable: innerNullable || q.minZero })
      i = q.next
      continue
    }
    if (ch === ')' || ch === '|') {
      // shouldn't happen at this level; bail
      return null
    }
    // Literal char (or `.`) — consumes one char; check quantifier
    const q = readQuantifier(body, i + 1)
    atoms.push({ nullable: q.nullable })
    i = q.next
  }
  return atoms
}

// Read a quantifier starting at `idx`. Returns nullable=true if the quantified
// atom can match zero occurrences, and the new cursor position.
function readQuantifier(body: string, idx: number): { nullable: boolean; minZero: boolean; next: number } {
  const c = body[idx]
  if (c === '*' || c === '?') {
    // also strip a possible non-greedy `?` after
    let next = idx + 1
    if (body[next] === '?') next++
    return { nullable: true, minZero: true, next }
  }
  if (c === '+') {
    let next = idx + 1
    if (body[next] === '?') next++
    return { nullable: false, minZero: false, next }
  }
  if (c === '{') {
    const m = body.slice(idx).match(/^\{(\d+)(?:,(\d*))?\}\??/)
    if (m) {
      const min = Number(m[1])
      const next = idx + m[0].length
      return { nullable: min === 0, minZero: min === 0, next }
    }
  }
  return { nullable: false, minZero: false, next: idx }
}
