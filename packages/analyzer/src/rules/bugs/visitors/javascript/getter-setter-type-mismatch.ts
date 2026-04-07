import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

// Detects: getter return type that doesn't match setter parameter type
// e.g., get name(): string but set name(value: number)
export const getterSetterTypeMismatchVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/getter-setter-type-mismatch',
  languages: JS_LANGUAGES,
  nodeTypes: ['class_body'],
  visit(node, filePath, sourceCode) {
    const getters = new Map<string, { returnType: string; node: import('tree-sitter').SyntaxNode }>()
    const setters = new Map<string, { paramType: string; node: import('tree-sitter').SyntaxNode }>()

    for (const member of node.namedChildren) {
      if (member.type !== 'method_definition') continue

      const nameNode = member.childForFieldName('name')
      if (!nameNode) continue

      const propName = nameNode.text
      const isStatic = member.namedChildren.some((c) => c.text === 'static')

      // Check if it's a getter (get keyword)
      const getKw = member.children.find((c) => c.text === 'get')
      const setKw = member.children.find((c) => c.text === 'set')

      if (getKw) {
        // In tree-sitter TypeScript, getter return type annotation is a direct
        // child of method_definition (not nested inside a function node)
        const returnType = member.childForFieldName('return_type')
          ?? member.namedChildren.find((c) => c.type === 'type_annotation')
        if (returnType) {
          getters.set((isStatic ? 'static:' : '') + propName, {
            returnType: returnType.text.replace('->', '').replace(':', '').trim(),
            node: member,
          })
        }
      }

      if (setKw) {
        // In tree-sitter TypeScript, setter parameters are a direct child
        // of method_definition (not nested inside a function node)
        const params = member.childForFieldName('parameters')
          ?? member.namedChildren.find((c) => c.type === 'formal_parameters')
        if (params) {
          const firstParam = params.namedChildren.find((c) =>
            c.type === 'required_parameter' || c.type === 'optional_parameter'
          )
          if (firstParam) {
            const typeAnnotation = firstParam.namedChildren.find((c) => c.type === 'type_annotation')
            if (typeAnnotation) {
              setters.set((isStatic ? 'static:' : '') + propName, {
                paramType: typeAnnotation.text.replace(':', '').trim(),
                node: member,
              })
            }
          }
        }
      }
    }

    // Check for mismatches
    for (const [propName, getter] of getters) {
      const setter = setters.get(propName)
      if (!setter) continue

      if (getter.returnType !== setter.paramType) {
        return makeViolation(
          this.ruleKey, getter.node, filePath, 'medium',
          'Getter/setter type mismatch',
          `Getter \`${propName}\` returns \`${getter.returnType}\` but setter expects \`${setter.paramType}\` — these types should match.`,
          sourceCode,
          `Make the getter return type and setter parameter type consistent for \`${propName}\`.`,
        )
      }
    }

    return null
  },
}
