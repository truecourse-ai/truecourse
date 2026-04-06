import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

// Detects: interface and class with same name — unsafe declaration merging
export const unsafeDeclarationMergingVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/unsafe-declaration-merging',
  languages: JS_LANGUAGES,
  nodeTypes: ['program'],
  visit(node, filePath, sourceCode) {
    const classNames = new Set<string>()
    const interfaceNames = new Set<string>()

    for (const child of node.namedChildren) {
      if (child.type === 'class_declaration') {
        const name = child.namedChildren.find((c) => c.type === 'type_identifier' || c.type === 'identifier')
        if (name) classNames.add(name.text)
      }
      if (child.type === 'interface_declaration') {
        const name = child.namedChildren.find((c) => c.type === 'type_identifier' || c.type === 'identifier')
        if (name) interfaceNames.add(name.text)
      }
    }

    // Find names that are both a class and an interface
    for (const name of classNames) {
      if (interfaceNames.has(name)) {
        // Find the class node to use as the violation location
        const classNode = node.namedChildren.find((c) =>
          c.type === 'class_declaration' &&
          c.namedChildren.find((n) => n.text === name)
        )
        if (classNode) {
          return makeViolation(
            this.ruleKey, classNode, filePath, 'medium',
            'Unsafe declaration merging',
            `Interface and class named \`${name}\` can merge unsafely — TypeScript may allow implementing the interface without fully satisfying class requirements.`,
            sourceCode,
            `Rename either the interface or the class to avoid declaration merging.`,
          )
        }
      }
    }

    return null
  },
}
