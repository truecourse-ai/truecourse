import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

// Detects: `{}` type annotation — matches everything except null/undefined
// This is rarely intentional and usually means the developer wanted `object` or `Record<string, unknown>`
export const emptyObjectTypeVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/empty-object-type',
  languages: JS_LANGUAGES,
  nodeTypes: ['type_annotation', 'type_alias_declaration', 'as_expression'],
  visit(node, filePath, sourceCode) {
    // Look for {} type (object_type with no members)
    const checkForEmptyObject = (n: import('web-tree-sitter').Node): import('web-tree-sitter').Node | null => {
      for (const child of n.namedChildren) {
        if (child.type === 'object_type') {
          // Check if it's empty (no named children = {})
          const namedChildren = child.namedChildren.filter((c) => c.type !== 'comment')
          if (namedChildren.length === 0 && child.text === '{}') {
            return child
          }
        }
      }
      return null
    }

    if (node.type === 'type_annotation') {
      const emptyObj = checkForEmptyObject(node)
      if (emptyObj && !isReactPropsParameter(node, filePath)) {
        return makeViolation(
          this.ruleKey, emptyObj, filePath, 'high',
          'Empty object type {}',
          '`{}` type matches everything except `null` and `undefined` — this is rarely intentional. Use `object` for non-primitive objects or `Record<string, unknown>` for generic objects.',
          sourceCode,
          'Replace `{}` with `object`, `Record<string, unknown>`, or a specific type.',
        )
      }
    }

    if (node.type === 'type_alias_declaration') {
      const typeNode = node.namedChildren.find((c) => c.type === 'object_type')
      if (typeNode) {
        const namedChildren = typeNode.namedChildren.filter((c) => c.type !== 'comment')
        if (namedChildren.length === 0 && typeNode.text === '{}') {
          return makeViolation(
            this.ruleKey, typeNode, filePath, 'high',
            'Empty object type {}',
            '`{}` type matches everything except `null` and `undefined` — use `object` or `Record<string, unknown>` instead.',
            sourceCode,
            'Replace `{}` with `object`, `Record<string, unknown>`, or a specific interface.',
          )
        }
      }
    }

    return null
  },
}

// `function Component(props: {})` in a React (.tsx/.jsx) file is the idiomatic
// "this component takes no props" annotation. The framework builds the props
// bag, so the `{}`-matches-everything footgun does not apply here — flagging it
// is noise. Scoped to a parameter literally named `props` in a JSX file so
// genuine `{}` misuse on other parameters / variables / return types still fires.
function isReactPropsParameter(typeAnnotation: import('web-tree-sitter').Node, filePath: string): boolean {
  if (!/\.(tsx|jsx)$/i.test(filePath)) return false
  const param = typeAnnotation.parent
  if (param?.type !== 'required_parameter' && param?.type !== 'optional_parameter') return false
  const pattern = param.childForFieldName('pattern')
  return pattern?.text === 'props'
}
