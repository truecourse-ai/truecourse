import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detects: @dataclass applied to a class that extends Enum
// dataclass semantics (auto-generated __init__, __repr__, etc.) conflict with Enum behavior
export const pythonDataclassEnumConflictVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/dataclass-enum-conflict',
  languages: ['python'],
  nodeTypes: ['decorated_definition'],
  visit(node, filePath, sourceCode) {
    // Check if there's a @dataclass decorator
    let hasDataclass = false

    for (const child of node.children) {
      if (child.type === 'decorator') {
        const decoratorName = child.namedChildren[0]
        if (!decoratorName) continue

        if (decoratorName.type === 'identifier' && decoratorName.text === 'dataclass') {
          hasDataclass = true
        } else if (decoratorName.type === 'attribute') {
          // dataclasses.dataclass
          const attr = decoratorName.childForFieldName('attribute')
          if (attr?.text === 'dataclass') hasDataclass = true
        } else if (decoratorName.type === 'call') {
          // @dataclass(...)
          const callFunc = decoratorName.childForFieldName('function')
          if (callFunc?.text === 'dataclass') hasDataclass = true
          if (callFunc?.type === 'attribute') {
            const attr = callFunc.childForFieldName('attribute')
            if (attr?.text === 'dataclass') hasDataclass = true
          }
        }
      }
    }

    if (!hasDataclass) return null

    // Find the class_definition child
    const classDef = node.namedChildren.find((c) => c.type === 'class_definition')
    if (!classDef) return null

    // Check if it extends Enum or IntEnum or similar
    const argumentList = classDef.childForFieldName('superclasses')
    if (!argumentList) return null

    const baseNames = argumentList.namedChildren.map((c) => c.text)
    const enumBases = baseNames.filter((b) =>
      b === 'Enum' || b === 'IntEnum' || b === 'StrEnum' || b === 'Flag' || b === 'IntFlag' || b.endsWith('Enum') || b.endsWith('Flag')
    )

    if (enumBases.length === 0) return null

    const className = classDef.childForFieldName('name')?.text ?? 'class'

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Dataclass on Enum subclass',
      `\`@dataclass\` applied to \`${className}\` which extends \`${enumBases[0]}\` — dataclass-generated methods conflict with Enum behavior.`,
      sourceCode,
      'Remove @dataclass or do not inherit from Enum — these two patterns are incompatible.',
    )
  },
}
