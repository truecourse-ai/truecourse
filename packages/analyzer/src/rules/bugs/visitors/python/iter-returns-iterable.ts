import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detects: __iter__ method returning Iterable instead of Iterator in type annotations
const ITERABLE_TYPES = new Set(['Iterable', 'Iterator', 'Generator'])

export const pythonIterReturnsIterableVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/iter-returns-iterable',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const nameNode = node.childForFieldName('name')
    if (!nameNode || nameNode.text !== '__iter__') return null

    // Check return type annotation
    const returnType = node.childForFieldName('return_type')
    if (!returnType) return null

    const returnTypeText = returnType.text.replace('->', '').trim()

    // Look for Iterable (but not Iterator or Generator)
    if (returnTypeText === 'Iterable' ||
        returnTypeText.startsWith('Iterable[') ||
        returnTypeText === 'typing.Iterable' ||
        returnTypeText.startsWith('typing.Iterable[')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        '__iter__ returns Iterable instead of Iterator',
        `\`__iter__\` is annotated to return \`${returnTypeText}\` — it should return \`Iterator\` which is the protocol type that \`__iter__\` is expected to produce.`,
        sourceCode,
        'Change the return type annotation to `Iterator[T]` or a specific iterator type.',
      )
    }

    return null
  },
}
