import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { findContainingStatement, findEnclosingFunction } from './_helpers.js'

export const uncheckedArrayAccessVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/unchecked-array-access',
  // TS/TSX only. The rule is meaningful when the project opts into
  // `noUncheckedIndexedAccess`, which only exists in TypeScript. Plain
  // JS / JSX has no static type system to opt into - every index access
  // is implicitly `T | undefined` and flagging it is pure noise.
  languages: ['typescript', 'tsx'],
  nodeTypes: ['subscript_expression'],
  visit(node, filePath, sourceCode) {
    const object = node.childForFieldName('object')
    const index = node.childForFieldName('index')
    if (!object || !index) return null

    // Only flag dynamic index access (variables), not literal indexes like arr[0]
    if (index.type === 'number') return null
    // Skip string indexes (object property access)
    if (index.type === 'string') return null
    // Skip when index is cast to a string-keyed type. `as string` is the
    // generic case; `as <Enum>` / `as <UnionAlias>` is the same pattern for
    // a Record/Map exhaustively keyed by that enum or string-union — the
    // cast IS the author's assertion that the lookup is total. Casts to
    // numeric (`as number` / `as Number`) don't carry that meaning for
    // arrays, so still fire.
    if (index.type === 'as_expression') {
      const castType = index.childForFieldName('type')?.text.trim() ?? ''
      const isNumericCast = /^(?:number|Number)$/.test(castType)
      if (!isNumericCast) return null
    }
    // Skip when object is a Record/Map type assertion (property access, not array)
    if (object.type === 'parenthesized_expression' && object.text.includes('Record<')) return null
    if (object.type === 'as_expression' && object.text.includes('Record<')) return null

    // Skip if the index is a well-known safe pattern like .length - 1
    const indexText = index.text
    if (indexText.includes('.length')) return null

    // Skip when index is a member expression (obj.prop) — typically Record/Map lookups, not array indexing
    if (index.type === 'member_expression') return null

    // Skip when result is accessed with optional chaining (obj[key]?.prop) — already null-safe
    if (node.parent && (node.parent.text.startsWith(node.text + '?.') || node.text.includes('?.'))) return null

    // Skip array writes (assignment targets) — writing to an index can't crash
    if (node.parent?.type === 'assignment_expression' && node.parent.childForFieldName('left')?.id === node.id) return null

    // Skip augmented assignment targets (`obj[k] += 1`, `obj[k] ||= …`) — the
    // read+write is an explicit update of that slot; treating it as an
    // unguarded read confuses real reads with intentional in-place mutation.
    if (node.parent?.type === 'augmented_assignment_expression' && node.parent.childForFieldName('left')?.id === node.id) return null

    // Skip when the result (or a transparent wrapper around it) is used with a
    // fallback. Common shape: `t(MAP[key]) ?? key` — the array access is buried
    // in a call but the outer expression supplies a default.
    if (hasFallbackAncestor(node)) return null

    // Skip access to a local variable whose type annotation is a Record/Map —
    // even without `noUncheckedIndexedAccess`, this is the explicit
    // "exhaustive dictionary" pattern and the user has told the type system
    // the keys are total.
    if (object.type === 'identifier' && isRecordTypedLocal(object.text, node)) return null

    // Check if there is a bounds check nearby (same block)
    const statement = findContainingStatement(node)
    if (!statement || !statement.parent) return null

    // When the access result is bound to a local (`const value = arr[i]`), a
    // later guard usually checks that *result* variable (`if (!value)`), not
    // the index. `process.env[name]` followed by `if (!value)` is the canonical
    // shape. Capture the bound name so the sibling scan can honor such guards.
    const resultVar = declaredResultName(statement, node)

    const siblings = statement.parent.namedChildren
    const stmtIndex = siblings.findIndex(n => n.id === statement.id)

    // Look at preceding AND following statements for a guard
    for (let i = Math.max(0, stmtIndex - 3); i <= Math.min(siblings.length - 1, stmtIndex + 2); i++) {
      const sibText = siblings[i].text
      if (sibText.includes('.length') && (sibText.includes(indexText) || sibText.includes('if'))) {
        return null
      }
      // Check for `key in obj` pattern (property existence check)
      if (sibText.includes(' in ') && sibText.includes(indexText)) {
        return null
      }
      // Check for guards that reference the index variable: if (!result), if (x >= N) return, etc.
      if (sibText.includes('if') && sibText.includes(indexText)) {
        return null
      }
      // Guard that checks the bound result variable, e.g. `if (!value) return …`.
      if (resultVar && sibText.includes('if') && sibText.includes(resultVar)) {
        return null
      }
    }

    // Check if inside a for loop that bounds the index variable to array length
    let ancestor: SyntaxNode | null = node.parent
    while (ancestor) {
      if (ancestor.type === 'for_statement' || ancestor.type === 'while_statement') {
        const condition = ancestor.childForFieldName('condition')
        if (condition && condition.text.includes('.length')) {
          // Match exact index or base variable (e.g., `i` for index `i + 1`)
          const baseVar = indexText.replace(/\s*[+\-]\s*\d+$/, '')
          if (condition.text.includes(indexText) || condition.text.includes(baseVar)) return null
        }
      }
      if (ancestor.type === 'function_declaration' || ancestor.type === 'arrow_function' ||
          ancestor.type === 'function_expression' || ancestor.type === 'method_definition') break
      ancestor = ancestor.parent
    }

    // Check if the parent is an if condition checking bounds
    let parent: SyntaxNode | null = node.parent
    while (parent) {
      if (parent.type === 'if_statement') {
        const condition = parent.childForFieldName('condition')
        if (condition) {
          const condText = condition.text
          if (condText.includes('.length')) return null
          if (condText.includes(' in ') && condText.includes(indexText)) return null
          // `findIndex`/`indexOf` return -1 on miss, so `idx !== -1`,
          // `idx >= 0`, and `idx > -1` are canonical sentinel/bounds
          // guards. Honor them when the if's condition names the same
          // index variable used in the subscript.
          if (
            condText.includes(indexText) &&
            (/!==?\s*-\s*1\b/.test(condText) ||
              />=\s*0\b/.test(condText) ||
              />\s*-\s*1\b/.test(condText))
          ) return null
        }
      }
      if (parent.type === 'ternary_expression' || parent.type === 'binary_expression') {
        if (parent.text.includes('.length')) return null
        if (parent.text.includes(' in ') && parent.text.includes(indexText)) return null
      }
      parent = parent.parent
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Unchecked array index access',
      `Array access ${object.text}[${indexText}] without a bounds check may return undefined.`,
      sourceCode,
      'Add a bounds check (e.g., if (i < arr.length)) before accessing the array by index.',
    )
  },
}

/**
 * If `statement` is a `const`/`let`/`var` declaration whose initializer
 * contains `accessNode` (i.e. the subscript result is bound to a single
 * named local), return that local's name. Returns null for destructuring
 * patterns or when the access isn't part of an initializer.
 */
function declaredResultName(statement: SyntaxNode, accessNode: SyntaxNode): string | null {
  if (statement.type !== 'lexical_declaration' && statement.type !== 'variable_declaration') {
    return null
  }
  for (let i = 0; i < statement.namedChildCount; i++) {
    const decl = statement.namedChild(i)
    if (decl?.type !== 'variable_declarator') continue
    const value = decl.childForFieldName('value')
    const nameNode = decl.childForFieldName('name')
    if (
      value &&
      nameNode?.type === 'identifier' &&
      accessNode.startIndex >= value.startIndex &&
      accessNode.endIndex <= value.endIndex
    ) {
      return nameNode.text
    }
  }
  return null
}

/**
 * Walk up through "transparent" wrappers (function call args, parens, type
 * assertions) looking for a binary_expression with a short-circuit fallback
 * (`||`, `??`, `&&`) where the walked-up subtree is the LEFT operand.
 */
function hasFallbackAncestor(start: SyntaxNode): boolean {
  let cur: SyntaxNode = start
  let parent: SyntaxNode | null = start.parent
  while (parent) {
    if (parent.type === 'binary_expression') {
      const operator = parent.childForFieldName('operator')?.text
      const left = parent.childForFieldName('left')
      if (
        left?.id === cur.id &&
        (operator === '||' || operator === '??' || operator === '&&')
      ) {
        return true
      }
      return false
    }
    // Step through wrappers that don't change the value's identity for
    // fallback-detection purposes.
    if (
      parent.type === 'arguments' ||
      parent.type === 'call_expression' ||
      parent.type === 'parenthesized_expression' ||
      parent.type === 'as_expression' ||
      parent.type === 'satisfies_expression' ||
      parent.type === 'non_null_expression' ||
      parent.type === 'type_assertion'
    ) {
      cur = parent
      parent = parent.parent
      continue
    }
    return false
  }
  return false
}

/**
 * Look up the enclosing function for a `const/let <name>: Record<…> = {…}`
 * declaration (or any Map/ReadonlyMap-typed declaration). If found, the
 * subscript access is into a dictionary the author explicitly typed.
 */
function isRecordTypedLocal(name: string, accessNode: SyntaxNode): boolean {
  const fn = findEnclosingFunction(accessNode)
  if (!fn) return false
  const body = fn.childForFieldName('body')
  if (!body) return false

  function walk(n: SyntaxNode): boolean {
    if (n.type === 'lexical_declaration' || n.type === 'variable_declaration') {
      for (let i = 0; i < n.namedChildCount; i++) {
        const decl = n.namedChild(i)
        if (decl?.type !== 'variable_declarator') continue
        const nameNode = decl.childForFieldName('name')
        if (nameNode?.type !== 'identifier' || nameNode.text !== name) continue
        const typeNode = decl.childForFieldName('type')
        if (typeNode && /\b(Record|ReadonlyMap|Map)\s*</.test(typeNode.text)) {
          return true
        }
      }
    }
    // Don't recurse into nested functions — those are different scopes.
    if (
      n.id !== body!.id &&
      (n.type === 'function_declaration' ||
        n.type === 'arrow_function' ||
        n.type === 'function' ||
        n.type === 'function_expression' ||
        n.type === 'method_definition')
    ) {
      return false
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c && walk(c)) return true
    }
    return false
  }
  return walk(body)
}
