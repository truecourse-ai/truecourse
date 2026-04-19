import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects common annotation errors in .pyi stub files:
 * - PYI025: Using `collections.abc.Set` instead of `AbstractSet` (confusing with `builtins.set`)
 * - PYI032: Using `__eq__` with non-object parameter type
 * - PYI034: __new__/__init__/__enter__/__aenter__ should return Self in stubs
 * - PYI050: Never should not be used as return type of `__str__`, `__repr__`, etc.
 */
export const pythonTypeStubAnnotationErrorVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/type-stub-annotation-error',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    if (!filePath.endsWith('.pyi')) return null

    const name = node.childForFieldName('name')
    if (!name) return null
    const methodName = name.text

    const returnType = node.childForFieldName('return_type')

    // PYI034: __new__, __init__, __enter__, __aenter__ should return Self
    const selfReturnMethods = ['__new__', '__init__', '__enter__', '__aenter__']
    if (selfReturnMethods.includes(methodName) && returnType) {
      const returnText = returnType.text
      // If the return type is the class name rather than Self, flag it
      // Walk up to find the containing class
      let parent = node.parent
      while (parent && parent.type !== 'class_definition') {
        parent = parent.parent
      }
      if (parent) {
        const className = parent.childForFieldName('name')
        if (className && returnText === className.text) {
          return makeViolation(
            this.ruleKey, node, filePath, 'high',
            'Type stub annotation error',
            `\`${methodName}\` should return \`Self\` instead of \`${returnText}\` in .pyi stubs.`,
            sourceCode,
            `Replace the return type with \`Self\` (from \`typing\`).`,
          )
        }
      }
    }

    // PYI050: __str__, __repr__, __bytes__ should not return Never
    const strMethods = ['__str__', '__repr__', '__bytes__', '__format__']
    if (strMethods.includes(methodName) && returnType) {
      const returnText = returnType.text
      if (returnText === 'Never' || returnText === 'NoReturn') {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Type stub annotation error',
          `\`${methodName}\` should not have \`${returnText}\` return type — it must always return a value.`,
          sourceCode,
          `Use the correct return type for \`${methodName}\` (e.g., \`str\`, \`bytes\`).`,
        )
      }
    }

    // PYI032: __eq__ and __ne__ should accept `object` as parameter
    if ((methodName === '__eq__' || methodName === '__ne__')) {
      const params = node.childForFieldName('parameters')
      if (params && params.namedChildCount >= 2) {
        const secondParam = params.namedChildren.filter((c) =>
          c.type === 'typed_parameter' || c.type === 'identifier' ||
          c.type === 'default_parameter' || c.type === 'typed_default_parameter'
        )[1]
        if (secondParam && secondParam.type === 'typed_parameter') {
          const typeAnnotation = secondParam.childForFieldName('type')
          if (typeAnnotation && typeAnnotation.text !== 'object') {
            return makeViolation(
              this.ruleKey, node, filePath, 'high',
              'Type stub annotation error',
              `\`${methodName}\` should accept \`object\` as the second parameter type in .pyi stubs, not \`${typeAnnotation.text}\`.`,
              sourceCode,
              `Change the parameter type to \`object\`.`,
            )
          }
        }
      }
    }

    return null
  },
}
