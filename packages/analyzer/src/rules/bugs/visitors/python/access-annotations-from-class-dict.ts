import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detects: SomeClass.__dict__["__annotations__"] or SomeClass.__dict__.get("__annotations__")
// Should use typing.get_type_hints() instead for correct resolution
export const pythonAccessAnnotationsFromClassDictVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/access-annotations-from-class-dict',
  languages: ['python'],
  nodeTypes: ['subscript', 'call'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'subscript') {
      // Pattern: SomeClass.__dict__["__annotations__"]
      const obj = node.childForFieldName('value')
      if (!obj || obj.type !== 'attribute') return null

      const attr = obj.childForFieldName('attribute')
      if (!attr || attr.text !== '__dict__') return null

      const sliceNode = node.childForFieldName('subscript')
      if (!sliceNode) return null

      const keyText = sliceNode.text
      if (keyText !== '"__annotations__"' && keyText !== "'__annotations__'") return null

      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Accessing __annotations__ from class __dict__',
        'Accessing `__annotations__` via `__dict__["__annotations__"]` may miss inherited annotations. Use `typing.get_type_hints()` for correct resolution.',
        sourceCode,
        'Replace with `typing.get_type_hints(ClassName)` to correctly resolve all annotations including inherited ones.',
      )
    }

    if (node.type === 'call') {
      // Pattern: SomeClass.__dict__.get("__annotations__", ...)
      const func = node.childForFieldName('function')
      if (!func || func.type !== 'attribute') return null

      const attr = func.childForFieldName('attribute')
      if (!attr || attr.text !== 'get') return null

      const obj = func.childForFieldName('object')
      if (!obj || obj.type !== 'attribute') return null

      const dictAttr = obj.childForFieldName('attribute')
      if (!dictAttr || dictAttr.text !== '__dict__') return null

      const args = node.childForFieldName('arguments')
      if (!args) return null

      const firstArg = args.namedChildren[0]
      if (!firstArg) return null

      const argText = firstArg.text
      if (argText !== '"__annotations__"' && argText !== "'__annotations__'") return null

      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Accessing __annotations__ from class __dict__',
        'Accessing `__annotations__` via `__dict__.get("__annotations__")` may miss inherited annotations. Use `typing.get_type_hints()` for correct resolution.',
        sourceCode,
        'Replace with `typing.get_type_hints(ClassName)` to correctly resolve all annotations including inherited ones.',
      )
    }

    return null
  },
}
