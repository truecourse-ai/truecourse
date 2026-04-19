import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

/**
 * Detects functions called both with and without `new` in the same file.
 * Some call sites use `new Foo()`, others use `Foo()` — inconsistent usage
 * suggests the function's intent is unclear (constructor vs factory).
 */

function collectCalls(root: SyntaxNode): Map<string, { withNew: SyntaxNode | null; withoutNew: SyntaxNode | null }> {
  const map = new Map<string, { withNew: SyntaxNode | null; withoutNew: SyntaxNode | null }>()

  function walk(n: SyntaxNode) {
    if (n.type === 'new_expression') {
      const ctor = n.childForFieldName('constructor')
      if (ctor?.type === 'identifier') {
        const name = ctor.text
        const entry = map.get(name) ?? { withNew: null, withoutNew: null }
        if (!entry.withNew) entry.withNew = n
        map.set(name, entry)
      }
    } else if (n.type === 'call_expression') {
      const fn = n.childForFieldName('function')
      if (fn?.type === 'identifier') {
        const name = fn.text
        const entry = map.get(name) ?? { withNew: null, withoutNew: null }
        if (!entry.withoutNew) entry.withoutNew = n
        map.set(name, entry)
      }
    }
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i)
      if (child) walk(child)
    }
  }

  walk(root)
  return map
}

export const inconsistentFunctionCallVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/inconsistent-function-call',
  languages: JS_LANGUAGES,
  nodeTypes: ['program'],
  visit(node, filePath, sourceCode) {
    const calls = collectCalls(node)

    for (const [name, { withNew, withoutNew }] of calls) {
      if (withNew && withoutNew) {
        // Report on the plain call site (without new) as the likely wrong one
        return makeViolation(
          this.ruleKey,
          withoutNew,
          filePath,
          'medium',
          'Inconsistent new usage',
          `\`${name}\` is called both with \`new\` and without \`new\` — pick one calling convention and stick to it.`,
          sourceCode,
          'Decide whether this is a constructor (always use `new`) or a factory function (never use `new`).',
        )
      }
    }

    return null
  },
}
