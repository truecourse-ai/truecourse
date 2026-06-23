import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Declaration sites whose declared name can collide with the contextual keyword.
const DECLARATION_TYPES = [
  'class_declaration', 'struct_declaration', 'interface_declaration', 'record_declaration',
  'enum_declaration', 'delegate_declaration', 'method_declaration', 'property_declaration',
  'event_declaration', 'variable_declarator', 'parameter', 'enum_member_declaration',
  'type_parameter', 'local_function_statement',
]

/**
 * A declared identifier literally named `extension`. C# 14 introduces `extension`
 * as a contextual keyword (extension blocks); an unescaped identifier of that name
 * collides and must be written `@extension`. Only declaration sites are flagged —
 * an already-escaped `@extension` carries the escape in its node text and so is
 * never matched.
 */
export const csharpExtensionKeywordConflictVisitor: CodeRuleVisitor = {
  ruleKey: 'style/deterministic/extension-keyword-conflict',
  languages: ['csharp'],
  nodeTypes: DECLARATION_TYPES,
  visit(node, filePath, sourceCode) {
    const name = node.childForFieldName('name')
    if (!name || name.text !== 'extension') return null

    return makeViolation(
      this.ruleKey, name, filePath, 'low',
      "Identifier collides with the 'extension' contextual keyword",
      "Identifier 'extension' collides with the C# 14 contextual keyword — rename it or escape it as '@extension'.",
      sourceCode,
      "Rename the identifier, or escape it as '@extension'.",
    )
  },
}
