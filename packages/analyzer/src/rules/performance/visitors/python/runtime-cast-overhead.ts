import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isInsidePythonLoop } from './_helpers.js'

const PYTHON_CAST_FUNCTIONS = new Set(['int', 'float', 'str', 'bool', 'list', 'tuple', 'dict', 'set', 'bytes'])

// Argument shapes that signal "this value varies per loop iteration" — the
// cast cannot be hoisted out of the loop and is not redundant.
//   attribute    — `obj.attr` where obj is typically the loop variable.
//   subscript    — `seq[i]` / `mapping[key]` — varies per iteration.
//   call         — `f()` / `obj.method()` — return value can change.
//   list/dict/set/tuple/generator comprehensions and inline displays —
//                  their materialization is the unavoidable work itself.
//   string interpolation, f-strings, concatenations — rebuilt per iteration.
const DYNAMIC_ARGUMENT_TYPES = new Set([
  'attribute',
  'subscript',
  'call',
  'await',
  'binary_operator',
  'unary_operator',
  'conditional_expression',
  'list_comprehension',
  'set_comprehension',
  'dictionary_comprehension',
  'generator_expression',
  'list',
  'tuple',
  'set',
  'dictionary',
  'concatenated_string',
  'parenthesized_expression',
  'lambda',
])

// f-strings parse as 'string' nodes with interpolation children. A plain
// string literal IS hoistable (it's the constant being cast); an f-string
// rebuilds per iteration and is not.
function isFStringWithInterpolation(node: { type: string; children: readonly { type: string }[] }): boolean {
  if (node.type !== 'string') return false
  for (const child of node.children) {
    if (child.type === 'interpolation') return true
  }
  return false
}

export const runtimeCastOverheadVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/runtime-cast-overhead',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'identifier') return null
    if (!PYTHON_CAST_FUNCTIONS.has(fn.text)) return null

    if (!isInsidePythonLoop(node)) return null

    // Inspect the first positional argument. The cast is meaningful to flag
    // only when the argument is a constant the developer COULD have hoisted
    // out of the loop — typically a SCREAMING_SNAKE module-level constant
    // or a numeric literal. Anything that varies per iteration (attribute on
    // loop var, subscript, call, comprehension, exception object) is a
    // genuine conversion that has to happen inside the loop.
    const args = node.childForFieldName('arguments')
    if (!args) return null
    const firstArg = args.namedChildren.find((c) => c.type !== 'comment')
    if (!firstArg) return null

    if (DYNAMIC_ARGUMENT_TYPES.has(firstArg.type)) return null
    if (isFStringWithInterpolation(firstArg as { type: string; children: readonly { type: string }[] })) return null

    // Plain identifier: only flag when it looks like a module-level constant
    // (SCREAMING_SNAKE_CASE). Any lowercase identifier is overwhelmingly
    // a parameter, the loop variable, or a per-iteration alias — all FPs.
    if (firstArg.type === 'identifier') {
      if (!/^[A-Z][A-Z0-9_]*$/.test(firstArg.text)) return null
    }

    // IO-bound loop body: when the loop does HTTP / DB / file IO,
    // the cast cost is invisible next to the network round-trip and
    // hoisting the SCREAMING_SNAKE cast saves microseconds at most.
    // Same heuristic as try-except-in-loop.
    let scope: import('web-tree-sitter').Node | null = node.parent
    while (scope) {
      if (scope.type === 'for_statement' || scope.type === 'while_statement') {
        const body = scope.childForFieldName('body') ?? scope
        const IO_PATTERNS = /\bawait\b|\brequests\.|\bhttpx\.|\bsession\.|\bsubprocess\.|\burllib\.|\burlopen\b|\.read\(|\.write\(|\.execute\(|\bopen\s*\(|\bjson\.loads?\b|\bjson\.dumps?\b/
        if (IO_PATTERNS.test(body.text)) return null
        break
      }
      scope = scope.parent
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Type casting in loop',
      `${fn.text}() called inside a loop on a constant argument. Hoist the cast above the loop.`,
      sourceCode,
      'Compute the cast once before the loop and reuse the value inside.',
    )
  },
}
