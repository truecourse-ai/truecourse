import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const jsEmptyFunctionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/empty-function',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['function_declaration', 'method_definition', 'arrow_function', 'function'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null
    if (body.type !== 'statement_block') return null

    // Check that statement block is empty (only braces, no statements)
    const statements = body.namedChildren
    if (statements.length > 0) return null

    // Skip constructors — useless-constructor handles those
    if (node.type === 'method_definition') {
      const nameNode = node.childForFieldName('name')
      if (nameNode?.text === 'constructor') return null
    }

    // Skip empty arrow functions inside .catch() — intentional no-op error suppression
    if (node.type === 'arrow_function') {
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
      // Skip default-value position in destructuring / parameter
      // defaults: `({ onSelect = () => {} })`,
      // `function f(cb = () => {})`. Empty arrow defaults are the
      // canonical "no-op default" idiom.
      if (parent?.type === 'object_assignment_pattern' || parent?.type === 'assignment_pattern') return null
      // Skip empty arrows whose property key is an event-handler /
      // callback prop name (`{ onSelect: () => {}, onError: () => {} }`).
      if (parent?.type === 'pair') {
        const key = parent.childForFieldName('key')
        const keyName = key?.type === 'property_identifier' ? key.text :
          (key?.type === 'string' ? key.text.replace(/^['"]|['"]$/g, '') : '')
        if (/^on[A-Z]/.test(keyName) || /^(?:default|noop|null|empty)/i.test(keyName)) return null
      }
      // Skip empty arrows assigned to noop / NOOP / NOP constants.
      if (parent?.type === 'variable_declarator') {
        const nameNode2 = parent.childForFieldName('name')
        const name = nameNode2?.text ?? ''
        if (/^(?:NO_?OP|noop|NOOP|EMPTY_FN|emptyFn|identity)$/i.test(name)) return null
      }
      // Skip default param value position:
      // `function f(cb = () => {})`. Tree-sitter TS shape:
      // `required_parameter` / `optional_parameter` directly
      // contains the arrow as a value child.
      if (parent?.type === 'required_parameter' ||
          parent?.type === 'optional_parameter' ||
          parent?.type === 'default_parameter') return null
    }

    // Get the function name for a clearer message
    const nameNode = node.childForFieldName('name')
    const name = nameNode?.text || 'anonymous'

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Empty function body',
      `Function \`${name}\` has an empty body — add an implementation or remove it.`,
      sourceCode,
      'Add an implementation or remove the empty function.',
    )
  },
}
