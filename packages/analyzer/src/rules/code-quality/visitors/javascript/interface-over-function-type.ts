import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const interfaceOverFunctionTypeVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/interface-over-function-type',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['interface_declaration'],
  visit(node, filePath, sourceCode) {
    const body = node.namedChildren.find((c) => c.type === 'object_type')
    if (!body) return null

    const members = body.namedChildren
    if (members.length !== 1) return null

    const onlyMember = members[0]
    if (onlyMember.type === 'call_signature') {
      const nameNode = node.childForFieldName('name')
      const name = nameNode?.text ?? 'Interface'
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Interface with single call signature',
        `\`interface ${name}\` has only a call signature — use a function type instead: \`type ${name} = (...) => ...\`.`,
        sourceCode,
        `Replace the interface with a type alias: \`type ${name} = ${onlyMember.text}\`.`,
      )
    }
    return null
  },
}
