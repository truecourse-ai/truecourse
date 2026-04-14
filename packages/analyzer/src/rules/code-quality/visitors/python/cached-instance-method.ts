import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { SyntaxNode } from 'tree-sitter'

function isInsideClass(node: SyntaxNode): boolean {
  let cur: SyntaxNode | null = node.parent
  while (cur) {
    if (cur.type === 'class_definition') return true
    if (cur.type === 'function_definition') return false
    cur = cur.parent
  }
  return false
}

function hasLruCacheDecorator(node: SyntaxNode): boolean {
  const decorated = node.parent
  if (!decorated || decorated.type !== 'decorated_definition') return false
  for (let i = 0; i < decorated.childCount; i++) {
    const child = decorated.child(i)
    if (!child || child.type !== 'decorator') continue
    const text = child.text
    if (text.includes('lru_cache') || text.includes('cache')) return true
  }
  return false
}

export const pythonCachedInstanceMethodVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/cached-instance-method',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    if (!hasLruCacheDecorator(node)) return null
    if (!isInsideClass(node)) return null

    // Check if first parameter is 'self'
    const params = node.childForFieldName('parameters')
    if (!params) return null
    const firstParam = params.namedChildren[0]
    if (!firstParam) return null
    const paramName = firstParam.type === 'identifier' ? firstParam.text : firstParam.childForFieldName('name')?.text
    if (paramName !== 'self') return null

    const nameNode = node.childForFieldName('name')
    const name = nameNode?.text || 'method'

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Cached instance method',
      `\`@lru_cache\` on instance method \`${name}\` caches \`self\`, causing a memory leak — the instance is never garbage collected.`,
      sourceCode,
      'Use `@functools.cached_property` for caching per-instance properties, or make the method static/class-level.',
    )
  },
}
