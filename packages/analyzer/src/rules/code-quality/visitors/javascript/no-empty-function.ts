import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getFunctionBody } from './_helpers.js'

export const jsNoEmptyFunctionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-empty-function',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['function_declaration', 'function_expression', 'arrow_function', 'method_definition'],
  visit(node, filePath, sourceCode) {
    const bodyNode = getFunctionBody(node)
    if (!bodyNode || bodyNode.type !== 'statement_block') return null

    if (bodyNode.namedChildren.length > 0) return null

    for (let i = 0; i < bodyNode.childCount; i++) {
      const child = bodyNode.child(i)
      if (child && child.type === 'comment') return null
    }

    // Skip empty functions inside .catch() — intentional no-op error suppression
    const parent = node.parent
    if (parent?.type === 'arguments') {
      const grandparent = parent.parent
      if (grandparent?.type === 'call_expression') {
        const gpFn = grandparent.childForFieldName('function')
        if (gpFn?.type === 'member_expression') {
          const gpProp = gpFn.childForFieldName('property')
          if (gpProp?.text === 'catch') return null
        }
      }
    }

    // Skip default callback props in destructuring patterns:
    // `function Comp({ onSelect = () => {}, onClose = () => {} })`.
    // Empty arrow defaults are the canonical "no-op default" idiom.
    if (parent?.type === 'object_assignment_pattern' || parent?.type === 'assignment_pattern') return null

    // Skip empty arrows that are values of object literals where
    // the pair's key looks like an event-handler / callback prop:
    // `{ onSelect: () => {}, onClose: () => {}, defaultLogger: () => {} }`.
    if (parent?.type === 'pair') {
      const key = parent.childForFieldName('key')
      const keyName = key?.type === 'property_identifier' ? key.text :
        (key?.type === 'string' ? key.text.replace(/^['"]|['"]$/g, '') : '')
      if (/^on[A-Z]/.test(keyName) || /^(?:default|noop|null|empty)/i.test(keyName) ||
          /^(?:setLoading|setError|setData)$/.test(keyName)) {
        return null
      }
    }

    // Skip empty arrows assigned to const noop / NOOP / NOP /
    // identityFn etc. — intentional placeholder constants.
    if (parent?.type === 'variable_declarator') {
      const nameNode2 = parent.childForFieldName('name')
      const name = nameNode2?.text ?? ''
      if (/^(?:NO_?OP|noop|NOOP|EMPTY_FN|emptyFn|identity)$/i.test(name)) return null
    }

    // Skip when the empty arrow is a default value of a default
    // parameter (`function f(cb = () => {})`). Tree-sitter TS
    // shape: `required_parameter` / `optional_parameter`
    // directly contains the initializer arrow as a value child.
    if (parent?.type === 'required_parameter' ||
        parent?.type === 'optional_parameter' ||
        parent?.type === 'default_parameter') return null

    const nameNode = node.childForFieldName('name')
    const name = nameNode?.text || 'anonymous'

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Empty function body',
      `Function \`${name}\` has an empty body. Add an implementation or a comment explaining why it's empty.`,
      sourceCode,
      'Add an implementation, throw a "not implemented" error, or add a comment explaining why the body is empty.',
    )
  },
}
