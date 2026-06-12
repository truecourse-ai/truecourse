import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const emptyPatternVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/empty-pattern',
  languages: JS_LANGUAGES,
  nodeTypes: ['object_pattern', 'array_pattern'],
  visit(node, filePath, sourceCode) {
    // Flag if the pattern has no named children (no bindings)
    const bindings = node.namedChildren.filter((c) => c.type !== 'comment')
    if (bindings.length === 0) {
      // An empty object pattern `{}` used as a function parameter is a deliberate
      // "ignore this argument" placeholder for a fixed callback signature —
      // React `forwardRef((  {}, ref) => …)` render functions, test-runner
      // fixtures (`async ({}: Ctx, use) => …`), etc. The positional slot is
      // dictated by the framework, so it can't be removed. This mirrors ESLint's
      // `no-empty-pattern` `allowObjectPatternsAsParameters` option. Empty
      // patterns in variable declarations (`const {} = foo()`) and empty array
      // patterns still bind nothing by mistake and keep firing.
      if (node.type === 'object_pattern' && isFunctionParameter(node)) return null
      const kind = node.type === 'object_pattern' ? '{}' : '[]'
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Empty destructuring pattern',
        `Empty destructuring pattern \`${kind}\` does not bind any variables.`,
        sourceCode,
        'Add variable bindings to the destructuring pattern or remove it entirely.',
      )
    }
    return null
  },
}

// True when `node` sits in a function's parameter list — either directly inside
// `formal_parameters` or wrapped in a `required_parameter` / `optional_parameter`
// (the typed form, e.g. `{}: Ctx`).
function isFunctionParameter(node: import('web-tree-sitter').Node): boolean {
  const parent = node.parent
  if (!parent) return false
  if (parent.type === 'formal_parameters') return true
  if (parent.type === 'required_parameter' || parent.type === 'optional_parameter') {
    return parent.parent?.type === 'formal_parameters'
  }
  return false
}
