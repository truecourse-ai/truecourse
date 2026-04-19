import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getPythonDecoratorName } from '../../../_shared/python-helpers.js'

type SyntaxNode = import('web-tree-sitter').Node

function isInsideClass(node: SyntaxNode): boolean {
  let parent = node.parent
  while (parent) {
    if (parent.type === 'class_definition') return true
    if (parent.type === 'function_definition') return false
    parent = parent.parent
  }
  return false
}

// Decorators that use `cls` as first argument instead of `self`.
const CLS_DECORATORS = new Set([
  'classmethod', 'validator', 'field_validator', 'root_validator',
  'model_validator', 'pre_load', 'post_load',
])

function hasDecoratorByName(node: SyntaxNode, names: Set<string>): boolean {
  const parent = node.parent
  if (!parent || parent.type !== 'decorated_definition') return false
  for (const child of parent.children) {
    if (child.type === 'decorator') {
      const name = getPythonDecoratorName(child)
      if (name && names.has(name)) return true
    }
  }
  return false
}

const STATIC_SET = new Set(['staticmethod'])

export const pythonSelfFirstArgumentVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/self-first-argument',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    if (!isInsideClass(node)) return null

    // Skip static methods (they don't have self)
    if (hasDecoratorByName(node, STATIC_SET)) return null

    // Skip class methods and Pydantic validators (they use cls, not self)
    if (hasDecoratorByName(node, CLS_DECORATORS)) return null

    const params = node.childForFieldName('parameters')
    if (!params) return null

    const firstParam = params.namedChildren[0]
    if (!firstParam) return null

    let firstName: string | undefined
    if (firstParam.type === 'identifier') {
      firstName = firstParam.text
    } else if (firstParam.type === 'typed_parameter') {
      firstName = firstParam.namedChildren[0]?.text
    }

    if (!firstName || firstName === 'self') return null

    const nameNode = node.childForFieldName('name')
    const methodName = nameNode?.text ?? 'method'

    return makeViolation(
      this.ruleKey, firstParam, filePath, 'low',
      'Instance method self naming',
      `The first argument of instance method \`${methodName}\` is \`${firstName}\` instead of the conventional \`self\`. This is confusing and breaks IDE tooling.`,
      sourceCode,
      `Rename the first parameter to \`self\`.`,
    )
  },
}
