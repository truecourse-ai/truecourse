import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonSubprocessWithoutShellVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/subprocess-without-shell',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    let objectName = ''
    if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      const obj = fn.childForFieldName('object')
      if (attr) methodName = attr.text
      if (obj) objectName = obj.text
    }

    const SUBPROCESS_CALL_METHODS = new Set(['call', 'run', 'check_output', 'check_call'])
    if (objectName !== 'subprocess' || !SUBPROCESS_CALL_METHODS.has(methodName)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    // Flag when first argument is a variable (could be user-controlled), not a literal list
    if (firstArg.type === 'identifier') {
      // Skip when the identifier is a parameter of the enclosing
      // function whose type annotation is `list[str]` /
      // `Sequence[str]` / `tuple[str, ...]`. The annotation
      // structurally rules out shell injection — there's no shell
      // interpolation when the first arg is a sequence of strings,
      // and the param type guarantees that shape.
      const paramName = firstArg.text
      if (isStringSequenceTypedParam(node, paramName)) return null

      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Subprocess call without shell review',
        `subprocess.${methodName}() called with a variable argument. If the value contains user input, shell injection is possible.`,
        sourceCode,
        'Ensure the command is not built from user input. Use a literal list of arguments.',
      )
    }

    return null
  },
}

function isStringSequenceTypedParam(callNode: import('web-tree-sitter').Node, paramName: string): boolean {
  // Walk to enclosing function_definition.
  let scope: import('web-tree-sitter').Node | null = callNode.parent
  while (scope) {
    if (scope.type === 'function_definition') break
    scope = scope.parent
  }
  if (!scope) return false
  const params = scope.childForFieldName('parameters')
  if (!params) return false
  for (const p of params.namedChildren) {
    if (p.type !== 'typed_parameter' && p.type !== 'typed_default_parameter') continue
    const inner = p.childForFieldName('pattern') ?? p.namedChildren[0]
    if (inner?.type !== 'identifier' || inner.text !== paramName) continue
    const typeNode = p.childForFieldName('type') ?? p.namedChildren[1]
    if (!typeNode) continue
    const annotText = typeNode.text
    // list[str] / List[str] / Sequence[str] / tuple[str, ...] / Iterable[str]
    if (/\b(?:list|List|Sequence|Iterable|tuple|Tuple)\s*\[\s*str/i.test(annotText)) return true
  }
  return false
}
