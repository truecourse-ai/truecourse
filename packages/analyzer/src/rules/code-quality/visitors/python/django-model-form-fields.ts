import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

function getClassBody(node: SyntaxNode): SyntaxNode | null {
  return node.childForFieldName('body')
}

function getMetaClass(classBody: SyntaxNode): SyntaxNode | null {
  for (const child of classBody.namedChildren) {
    if (child.type === 'class_definition') {
      const name = child.childForFieldName('name')
      if (name?.text === 'Meta') return child
    }
  }
  return null
}

function inheritsFromModelForm(node: SyntaxNode): boolean {
  const supers = node.childForFieldName('superclasses')
  if (!supers) return false
  for (const child of supers.namedChildren) {
    const baseName = extractTerminalName(child)
    if (baseName === 'ModelForm') return true
  }
  return false
}

function extractTerminalName(node: SyntaxNode): string | null {
  if (node.type === 'identifier') return node.text
  if (node.type === 'attribute') {
    const attr = node.childForFieldName('attribute')
    return attr?.text ?? null
  }
  if (node.type === 'subscript') {
    const value = node.childForFieldName('value')
    if (value) return extractTerminalName(value)
  }
  return null
}

export const pythonDjangoModelFormFieldsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/django-model-form-fields',
  languages: ['python'],
  nodeTypes: ['class_definition'],
  visit(node, filePath, sourceCode) {
    if (!inheritsFromModelForm(node)) return null

    const classBody = getClassBody(node)
    if (!classBody) return null

    const metaClass = getMetaClass(classBody)
    if (!metaClass) return null

    const metaBody = getClassBody(metaClass)
    if (!metaBody) return null

    // Look for fields = '__all__' or exclude = [...]
    for (const rawStmt of metaBody.namedChildren) {
      // tree-sitter wraps assignments in expression_statement
      let stmt = rawStmt
      if (stmt.type === 'expression_statement') {
        const inner = stmt.namedChildren[0]
        if (inner?.type === 'assignment') stmt = inner
        else continue
      }
      if (stmt.type !== 'assignment') continue
      const left = stmt.childForFieldName('left')
      const right = stmt.childForFieldName('right')
      if (!left || !right) continue

      if (left.text === 'fields' && (right.text === "'__all__'" || right.text === '"__all__"')) {
        return makeViolation(
          this.ruleKey, stmt, filePath, 'medium',
          'Django ModelForm with fields = "__all__"',
          '`fields = "__all__"` exposes all model fields — list fields explicitly to avoid unintentional exposure.',
          sourceCode,
          'Replace `fields = "__all__"` with an explicit list of field names.',
        )
      }
      if (left.text === 'exclude') {
        return makeViolation(
          this.ruleKey, stmt, filePath, 'medium',
          'Django ModelForm with exclude',
          '`exclude` in ModelForm hides which fields are included — list fields explicitly instead.',
          sourceCode,
          'Replace `exclude = [...]` with `fields = [...]` listing the fields you want to include.',
        )
      }
    }
    return null
  },
}
