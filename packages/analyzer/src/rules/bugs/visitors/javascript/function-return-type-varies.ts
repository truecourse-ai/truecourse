import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { TS_LANGUAGES } from './_helpers.js'

/**
 * Detect: Function returns different types from different paths.
 * Corresponds to sonarjs S3800 (function-return-type).
 * Uses type query to check the return type of the function.
 */

/** Normalize TypeScript literal types to their base types */
function normalizeType(typeStr: string): string {
  // `T & {}` is the literal-preserving widening idiom: it keeps editor
  // autocomplete for known members while still accepting any `T` (e.g.
  // `"a" | "b" | (string & {})`). It is semantically the base type `T`, so
  // strip the empty-object intersection before comparing return types.
  let t = typeStr.replace(/\s*&\s*\{\s*\}/g, '').trim()
  // String literal types: "hello", 'world' → string
  if (/^["']/.test(t)) return 'string'
  // Number literal types: 42, 3.14 → number
  if (/^-?\d/.test(t)) return 'number'
  // Boolean literal types
  if (t === 'true' || t === 'false') return 'boolean'
  return t
}

/**
 * Peel `expr as const`, `expr satisfies T`, `<T>expr`, and `(expr)` wrappers
 * so callers can inspect the underlying expression (e.g. an object literal).
 */
function unwrapTypeAssertions(node: SyntaxNode): SyntaxNode {
  let cur: SyntaxNode = node
  while (
    cur.type === 'as_expression' ||
    cur.type === 'satisfies_expression' ||
    cur.type === 'type_assertion' ||
    cur.type === 'parenthesized_expression'
  ) {
    const inner = cur.namedChildren[0]
    if (!inner) break
    cur = inner
  }
  return cur
}

function collectReturnStatements(node: SyntaxNode): SyntaxNode[] {
  const returns: SyntaxNode[] = []
  function walk(n: SyntaxNode) {
    if (n.type === 'return_statement') {
      returns.push(n)
      return
    }
    // Don't descend into nested functions
    if (n.type === 'function_declaration' || n.type === 'function_expression' ||
        n.type === 'arrow_function' || n.type === 'method_definition') {
      return
    }
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i)
      if (child) walk(child)
    }
  }
  walk(node)
  return returns
}

export const functionReturnTypeVariesVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/function-return-type-varies',
  languages: TS_LANGUAGES,
  nodeTypes: ['function_declaration', 'method_definition'],
  needsTypeQuery: true,
  visit(node, filePath, sourceCode, _dataFlow, typeQuery) {
    if (!typeQuery) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    // Skip when the function has an explicit return type annotation — the compiler enforces consistency
    const returnType = node.childForFieldName('return_type')
    if (returnType) return null
    // Also check for type_annotation child (some grammars use this)
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child?.type === 'type_annotation' && child.startPosition.row >= (node.childForFieldName('parameters')?.endPosition.row ?? 0)) {
        return null
      }
    }

    const returnStmts = collectReturnStatements(body)
    if (returnStmts.length < 2) return null

    // Get types of each return value
    const returnTypes = new Set<string>()
    for (const ret of returnStmts) {
      const value = ret.namedChildren[0]
      if (!value) {
        returnTypes.add('undefined')
        continue
      }
      const typeStr = typeQuery.getTypeAtPosition(
        filePath,
        value.startPosition.row,
        value.startPosition.column,
        value.endPosition.row,
        value.endPosition.column,
      )
      if (typeStr) {
        // Normalize literal types to their base types:
        // "hello" → string, 42 → number, true → boolean
        returnTypes.add(normalizeType(typeStr))
      }
    }

    // Skip when ALL returns use the same constructor/function call (e.g., all NextResponse.json(...))
    const returnCallNames = new Set<string>()
    let allReturnsAreCallsToSameFunction = true
    for (const ret of returnStmts) {
      const value = ret.namedChildren[0]
      if (!value || value.type !== 'call_expression') {
        allReturnsAreCallsToSameFunction = false
        break
      }
      const callee = value.childForFieldName('function')
      if (!callee) {
        allReturnsAreCallsToSameFunction = false
        break
      }
      returnCallNames.add(callee.text)
    }
    if (allReturnsAreCallsToSameFunction && returnCallNames.size === 1) return null

    // Skip when all return expressions are object literals (possibly wrapped in
    // `as const` / `satisfies T` / a type assertion / parens) with either:
    //   - the same set of keys (e.g. `{isNew: true}` vs `{isNew: false}`)
    //   - a shared discriminator key whose value is a literal in every return
    //     (e.g. `{state: 'A', x}` vs `{state: 'B', y}` — TypeScript-style
    //     discriminated union, by design has different payload keys per arm)
    const objectLiterals = returnStmts.map(ret => {
      const raw = ret.namedChildren[0]
      return raw ? unwrapTypeAssertions(raw) : null
    })
    const allObjectLiterals = objectLiterals.every(v => v !== null && v.type === 'object')
    if (allObjectLiterals && returnStmts.length >= 2) {
      const objects = objectLiterals as SyntaxNode[]
      const keySets = objects.map(value => {
        const keys: string[] = []
        for (let i = 0; i < value.namedChildCount; i++) {
          const prop = value.namedChild(i)
          if (prop?.type === 'pair') {
            const key = prop.childForFieldName('key')
            if (key) keys.push(key.text)
          } else if (prop?.type === 'shorthand_property_identifier' || prop?.type === 'shorthand_property_identifier_pattern') {
            keys.push(prop.text)
          } else if (prop?.type === 'spread_element') {
            keys.push(`...${prop.text}`)
          }
        }
        return keys.sort().join(',')
      })
      const allSameKeys = keySets.every(k => k === keySets[0])
      if (allSameKeys) return null

      // Discriminated-union check: collect property keys whose value is a primitive
      // literal (string/number/boolean) in each return. If at least one such key
      // is present in every return, that's the discriminator and the union is
      // narrowable at call sites.
      const literalKeysPerReturn = objects.map(value => {
        const keys = new Set<string>()
        for (let i = 0; i < value.namedChildCount; i++) {
          const prop = value.namedChild(i)
          if (prop?.type !== 'pair') continue
          const key = prop.childForFieldName('key')
          const val = prop.childForFieldName('value')
          if (!key || !val) continue
          if (val.type === 'string' || val.type === 'number' ||
              val.type === 'true' || val.type === 'false') {
            keys.add(key.text)
          }
        }
        return keys
      })
      if (literalKeysPerReturn.every(s => s.size > 0)) {
        const common = [...literalKeysPerReturn[0]].filter(k =>
          literalKeysPerReturn.every(s => s.has(k)),
        )
        if (common.length > 0) return null
      }
    }

    // Normalize void-like return types: void, Promise<void>, and undefined are semantically equivalent
    const VOID_LIKE = new Set(['void', 'Promise<void>', 'undefined'])
    const normalizedReturnTypes = new Set<string>()
    for (const t of returnTypes) {
      normalizedReturnTypes.add(VOID_LIKE.has(t) ? 'void' : t)
    }

    // If there are significantly different base types
    if (normalizedReturnTypes.size > 1) {
      const types = [...normalizedReturnTypes]
      const baseTypes = types.filter(t => t !== 'null' && t !== 'undefined')

      // Normalize base types: treat empty arrays as compatible with any array type,
      // and objects with same keys but different boolean literal values as same type
      const normalizedBaseTypes = new Set(baseTypes.map(t => {
        // Treat empty array literal types (e.g., "never[]") as "array"
        if (t === 'never[]' || t === '[]') return 'array'
        // Normalize any array type to "array" so they compare equal to empty arrays
        if (t.endsWith('[]')) return 'array'
        return t
      }))

      // Allow nullable returns (type | null), but flag truly mixed returns (string | number)
      if (normalizedBaseTypes.size > 1) {
        const nameNode = node.childForFieldName('name')
        const fnName = nameNode?.text ?? '<anonymous>'
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Function returns different types',
          `Function \`${fnName}\` returns \`${types.join(' | ')}\` from different code paths — this makes the return type unpredictable.`,
          sourceCode,
          'Ensure consistent return types or explicitly type the function return.',
        )
      }
    }

    return null
  },
}
