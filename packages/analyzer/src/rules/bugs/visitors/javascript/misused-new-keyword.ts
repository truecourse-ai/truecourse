import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

// Detects: interface with a method named 'constructor', or class with a method named 'new'
// These are misused patterns that confuse TypeScript
export const misusedNewKeywordVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/misused-new-keyword',
  languages: JS_LANGUAGES,
  nodeTypes: ['interface_declaration', 'class_declaration'],
  visit(node, filePath, sourceCode) {
    const body = node.namedChildren.find((c) =>
      c.type === 'interface_body' || c.type === 'class_body'
    )
    if (!body) return null

    const isInterface = node.type === 'interface_declaration'

    for (const member of body.namedChildren) {
      if (isInterface) {
        // Interface should not have a method named 'constructor'
        if (member.type === 'construct_signature') {
          // construct_signature is valid in interfaces (new(): SomeType)
          // but method_signature named 'constructor' is a bug
          continue
        }
        if (member.type === 'method_signature') {
          const name = member.childForFieldName('name')
          if (name?.text === 'constructor') {
            return makeViolation(
              this.ruleKey, member, filePath, 'high',
              'Interface has constructor method',
              'Interface has a `constructor` method — interfaces describe object shapes, not constructors. Use a `construct_signature` (`new(): Type`) if you need to describe constructability.',
              sourceCode,
              'Replace `constructor()` in the interface with `new(): ReturnType` if you want to describe a constructor.',
            )
          }
        }
      } else {
        // Class should not have a method named 'new'
        if (member.type === 'method_definition') {
          const name = member.childForFieldName('name')
          if (name?.text === 'new') {
            return makeViolation(
              this.ruleKey, member, filePath, 'high',
              'Class has method named "new"',
              'Class has a method named `new` — this is likely a mistake. The `new` keyword is not a valid method name for class instances.',
              sourceCode,
              'Rename the `new` method to something descriptive like `create()` or `build()`.',
            )
          }
        }
      }
    }

    return null
  },
}
