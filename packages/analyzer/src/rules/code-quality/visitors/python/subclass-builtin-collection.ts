import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const BUILTIN_COLLECTIONS: Record<string, string> = {
  dict: 'collections.UserDict',
  list: 'collections.UserList',
  str: 'collections.UserString',
}

export const pythonSubclassBuiltinCollectionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/subclass-builtin-collection',
  languages: ['python'],
  nodeTypes: ['class_definition'],
  visit(node, filePath, sourceCode) {
    const superclasses = node.childForFieldName('superclasses')
    if (!superclasses) return null

    // Skip classes that also inherit from any Enum type — e.g. class MyEnum(str, enum.Enum)
    // This is the standard Python pattern for string enums (pre-StrEnum)
    const bases = superclasses.namedChildren
    const hasEnumBase = bases.some((b) => {
      const text = b.text
      return text.includes('Enum')
    })
    if (hasEnumBase) return null

    for (const base of bases) {
      if (base.type === 'identifier' && BUILTIN_COLLECTIONS[base.text]) {
        const replacement = BUILTIN_COLLECTIONS[base.text]
        return makeViolation(
          this.ruleKey, base, filePath, 'medium',
          `Subclassing built-in \`${base.text}\``,
          `Subclassing \`${base.text}\` directly has surprising behavior with overridden methods — use \`${replacement}\` instead.`,
          sourceCode,
          `Replace \`${base.text}\` with \`${replacement}\` as the base class.`,
        )
      }
    }

    return null
  },
}
