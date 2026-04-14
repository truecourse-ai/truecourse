import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { SyntaxNode } from 'tree-sitter'

function getMethodNames(classBody: SyntaxNode): string[] {
  const names: string[] = []
  for (const child of classBody.namedChildren) {
    let funcNode: SyntaxNode | null = null
    if (child.type === 'function_definition') funcNode = child
    else if (child.type === 'decorated_definition') {
      funcNode = child.namedChildren.find((c) => c.type === 'function_definition') ?? null
    }
    if (funcNode) {
      const name = funcNode.childForFieldName('name')
      if (name) names.push(name.text)
    }
  }
  return names
}

export const pythonClassAsDataStructureVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/class-as-data-structure',
  languages: ['python'],
  nodeTypes: ['class_definition'],
  visit(node, filePath, sourceCode) {
    const bodyNode = node.childForFieldName('body')
    if (!bodyNode) return null

    const methods = getMethodNames(bodyNode)

    // Only has __init__ (and optionally __repr__/__eq__)
    const nonTrivialMethods = methods.filter((m) => !['__init__', '__repr__', '__str__', '__eq__', '__hash__'].includes(m))
    if (nonTrivialMethods.length > 0) return null
    if (!methods.includes('__init__')) return null
    if (methods.length > 1) return null // has more than just __init__

    // Check if __init__ only assigns attributes
    const initNode = bodyNode.namedChildren.find((c) => {
      if (c.type === 'function_definition') {
        return c.childForFieldName('name')?.text === '__init__'
      }
      return false
    })
    if (!initNode) return null

    const initBody = initNode.childForFieldName('body')
    if (!initBody) return null

    // Check all statements are self.x = y assignments
    const stmts = initBody.namedChildren
    if (stmts.length === 0) return null
    const allAssignments = stmts.every((s) => {
      if (s.type !== 'assignment' && s.type !== 'expression_statement') return false
      if (s.type === 'assignment') {
        const left = s.childForFieldName('left')
        return left?.type === 'attribute' && left.childForFieldName('object')?.text === 'self'
      }
      return true
    })
    if (!allAssignments) return null

    const nameNode = node.childForFieldName('name')
    const name = nameNode?.text || 'class'

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Class used as plain data structure',
      `Class \`${name}\` has only \`__init__\` setting attributes — consider using \`@dataclass\` or \`NamedTuple\`.`,
      sourceCode,
      'Replace with `@dataclass` or `typing.NamedTuple` for cleaner data containers.',
    )
  },
}
