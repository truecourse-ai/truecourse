import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detect: JsonResponse(non_dict_data) with default safe=True
// or JsonResponse(non_dict_data, safe=True) explicitly

function isNonDictArg(node: SyntaxNode): boolean {
  return node.type === 'list' || node.type === 'tuple' || node.type === 'string' ||
    node.type === 'integer' || node.type === 'float' || node.type === 'true' || node.type === 'false'
}

export const pythonDjangoJsonResponseSafeFlagVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/django-json-response-safe-flag',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    // Match JsonResponse(...) or django.http.JsonResponse(...)
    const fnText = fn.text
    if (!fnText.endsWith('JsonResponse')) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const positionalArgs = args.namedChildren.filter(c => c.type !== 'keyword_argument' && c.type !== 'comment')
    if (positionalArgs.length === 0) return null

    const firstArg = positionalArgs[0]

    // Check for explicit safe=True or no safe= kwarg (defaults to True)
    const kwArgs = args.namedChildren.filter(c => c.type === 'keyword_argument')
    const safeKwarg = kwArgs.find(c => c.childForFieldName('name')?.text === 'safe')

    let hasSafeTrue = true // default is True
    if (safeKwarg) {
      const safeVal = safeKwarg.childForFieldName('value')
      hasSafeTrue = safeVal?.text !== 'False'
    }

    if (hasSafeTrue && isNonDictArg(firstArg)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Django JsonResponse safe flag incorrect',
        `\`JsonResponse(${firstArg.text}, ...)\` uses \`safe=True\` (the default) with a non-dict object — this will raise \`TypeError\`. Pass \`safe=False\` for non-dict data.`,
        sourceCode,
        'Add `safe=False` to the `JsonResponse` call when passing non-dict data.',
      )
    }
    return null
  },
}
