import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonMetaclassABCMetaVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/metaclass-abcmeta',
  languages: ['python'],
  nodeTypes: ['class_definition'],
  visit(node, filePath, sourceCode) {
    // Detect: class Foo(metaclass=ABCMeta):
    const superclasses = node.childForFieldName('superclasses')
    if (!superclasses) return null

    for (const arg of superclasses.namedChildren) {
      if (arg.type === 'keyword_argument') {
        const key = arg.childForFieldName('name')
        const val = arg.childForFieldName('value')
        if (key?.text === 'metaclass' && val?.text === 'ABCMeta') {
          return makeViolation(
            this.ruleKey, arg, filePath, 'low',
            'Use ABC instead of metaclass=ABCMeta',
            '`metaclass=ABCMeta` should be replaced by inheriting from `ABC` — more readable.',
            sourceCode,
            'Replace `metaclass=ABCMeta` with inheriting from `ABC`: `class Foo(ABC):`.',
          )
        }
      }
    }

    return null
  },
}
