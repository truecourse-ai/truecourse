import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_MAGIC_NUMBER_WHITELIST, parseCSharpNumber, isCSharpTestMethod } from './_helpers.js'

// Time conversion factors: only skip when 2+ appear together in a
// multiplication chain (e.g. `24 * 60 * 60`).
const TIME_FACTORS = new Set([24, 60, 3600, 86400])

function hasTimeFactorInChain(node: SyntaxNode): boolean {
  if (node.type === 'integer_literal' || node.type === 'real_literal') {
    const val = parseCSharpNumber(node.text)
    return val !== null && TIME_FACTORS.has(val)
  }
  if (node.type === 'binary_expression' || node.type === 'parenthesized_expression') {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && hasTimeFactorInChain(child)) return true
    }
  }
  return false
}

function isConstDeclarationContext(node: SyntaxNode): boolean {
  let ancestor: SyntaxNode | null = node.parent
  while (ancestor) {
    if (ancestor.type === 'variable_declarator') {
      const stmt = ancestor.parent?.parent // variable_declaration → statement/field
      if (stmt?.type === 'local_declaration_statement'
        && stmt.children.some((c) => c?.type === 'modifier' && c.text === 'const')) return true
      if (stmt?.type === 'field_declaration') {
        const isConst = stmt.children.some((c) => c?.type === 'modifier' && (c.text === 'const' || c.text === 'readonly'))
        if (isConst) return true
      }
      const name = ancestor.childForFieldName('name')?.text
      if (name && /^[A-Z][A-Z0-9_]*$/.test(name)) return true
      return false
    }
    if (ancestor.type === 'enum_member_declaration') return true
    ancestor = ancestor.parent
  }
  return false
}

function isInsideGetHashCode(node: SyntaxNode): boolean {
  let ancestor: SyntaxNode | null = node.parent
  while (ancestor) {
    if (ancestor.type === 'method_declaration') {
      return ancestor.childForFieldName('name')?.text === 'GetHashCode'
    }
    ancestor = ancestor.parent
  }
  return false
}

function isInsideTestMethodScope(node: SyntaxNode): boolean {
  let ancestor: SyntaxNode | null = node.parent
  while (ancestor) {
    if (ancestor.type === 'method_declaration') return isCSharpTestMethod(ancestor)
    ancestor = ancestor.parent
  }
  return false
}

export const csharpMagicNumberVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/magic-number',
  languages: ['csharp'],
  nodeTypes: ['integer_literal', 'real_literal'],
  visit(node, filePath, sourceCode) {
    const val = parseCSharpNumber(node.text)
    if (val === null || !Number.isFinite(val)) return null
    if (CSHARP_MAGIC_NUMBER_WHITELIST.has(val)) return null

    let parent = node.parent
    if (!parent) return null
    // Treat `-5` as one literal: evaluate the unary's context instead.
    if (parent.type === 'prefix_unary_expression') {
      if (CSHARP_MAGIC_NUMBER_WHITELIST.has(-val)) return null
      parent = parent.parent
      if (!parent) return null
    }
    const parentType = parent.type

    // Initializers (`var max = 10`), enum members, parameter defaults,
    // attribute arguments and return values name or scope the number already.
    if (parentType === 'variable_declarator') return null
    if (parentType === 'enum_member_declaration') return null
    if (parentType === 'parameter') return null
    if (parentType === 'attribute_argument') return null
    if (parentType === 'return_statement') return null
    if (parentType === 'assignment_expression') return null
    // Object-initializer entries (`new Options { Retries = 3 }`) are named.
    if (parentType === 'initializer_expression') return null

    // Only flag literals used in expressions or as call arguments.
    if (parentType !== 'binary_expression' && parentType !== 'argument') return null
    // Indexer access (`items[3]`) is excluded, like array subscripts in JS.
    if (parentType === 'argument' && parent.parent?.type === 'bracketed_argument_list') return null

    // Time conversion factor multiplied by another time factor — idiomatic.
    if (parentType === 'binary_expression' && TIME_FACTORS.has(val)) {
      const op = parent.childForFieldName('operator')
      if (op?.text === '*') {
        const left = parent.childForFieldName('left')
        const right = parent.childForFieldName('right')
        const sibling = left?.id === node.id || left?.id === node.parent?.id ? right : left
        if (sibling && hasTimeFactorInChain(sibling)) return null
      }
    }

    // Inside a const/readonly/SCREAMING_CASE declaration the number IS the
    // named constant being defined.
    if (isConstDeclarationContext(node)) return null

    // Hash-combining primes in GetHashCode overrides are idiomatic.
    if (isInsideGetHashCode(node)) return null

    // Unit-named factory arguments are self-documenting: TimeSpan.FromSeconds(10).
    if (parentType === 'argument') {
      const invocation = parent.parent?.parent
      if (invocation?.type === 'invocation_expression') {
        const fn = invocation.childForFieldName('function')
        if (fn?.type === 'member_access_expression' && fn.childForFieldName('name')?.text.startsWith('From')) {
          return null
        }
      }
    }

    // Expected values in test methods are the canonical literal home.
    if (isInsideTestMethodScope(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      `Magic number: ${node.text}`,
      `Numeric literal \`${node.text}\` has no explanation. Extract it to a named constant for clarity.`,
      sourceCode,
      `Extract \`${node.text}\` to a named constant: \`private const int Threshold = ${node.text};\``,
    )
  },
}
