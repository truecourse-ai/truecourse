import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { SyntaxNode } from 'tree-sitter'
import { importsDjango, isDjangoModelClass } from '../../../_shared/python-framework-detection.js'

function hasStrMethod(classBody: SyntaxNode): boolean {
  for (const child of classBody.namedChildren) {
    let funcNode: SyntaxNode | null = null
    if (child.type === 'function_definition') funcNode = child
    else if (child.type === 'decorated_definition') {
      funcNode = child.namedChildren.find((c) => c.type === 'function_definition') ?? null
    }
    if (funcNode) {
      const name = funcNode.childForFieldName('name')
      if (name?.text === '__str__') return true
    }
  }
  return false
}

export const pythonDjangoModelWithoutStrVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/django-model-without-str',
  languages: ['python'],
  nodeTypes: ['class_definition'],
  visit(node, filePath, sourceCode) {
    // Gate on the file actually importing Django. Pre-fix this rule fired on
    // Pydantic `BaseModel`, SQLAlchemy `DeclarativeModel`, and any class whose
    // superclass text happened to contain "Model".
    if (!importsDjango(node)) return null
    if (!isDjangoModelClass(node)) return null

    const classBody = node.childForFieldName('body')
    if (!classBody) return null

    if (hasStrMethod(classBody)) return null

    const nameNode = node.childForFieldName('name')
    const name = nameNode?.text || 'Model'

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Django model without __str__',
      `Model \`${name}\` does not define \`__str__\` — the admin and debug output will show unhelpful object representations.`,
      sourceCode,
      'Add a `__str__` method that returns a human-readable string representation of the model instance.',
    )
  },
}
