import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detect: network calls inside AWS Lambda handler functions without timeout parameter
// Lambda functions are named 'handler' or 'lambda_handler' by convention

const NETWORK_CALLS = new Set([
  'requests.get', 'requests.post', 'requests.put', 'requests.delete',
  'requests.patch', 'requests.head', 'requests.request',
  'urllib.request.urlopen', 'httpx.get', 'httpx.post', 'httpx.put',
  'httpx.delete', 'httpx.patch',
])

function isLambdaHandler(funcNode: SyntaxNode): boolean {
  const name = funcNode.childForFieldName('name')?.text
  return name === 'lambda_handler' || name === 'handler'
}

function hasTimeoutArg(callNode: SyntaxNode): boolean {
  const args = callNode.childForFieldName('arguments')
  if (!args) return false
  return args.namedChildren.some(c => {
    if (c.type !== 'keyword_argument') return false
    return c.childForFieldName('name')?.text === 'timeout'
  })
}

export const pythonLambdaNetworkCallNoTimeoutVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/lambda-network-call-no-timeout',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let callText = ''
    if (fn.type === 'attribute') {
      const obj = fn.childForFieldName('object')
      const attr = fn.childForFieldName('attribute')
      if (obj && attr) callText = `${obj.text}.${attr.text}`
    }

    if (!NETWORK_CALLS.has(callText)) return null
    if (hasTimeoutArg(node)) return null

    // Check if we're inside a Lambda handler
    let current: SyntaxNode | null = node.parent
    while (current) {
      if (current.type === 'function_definition' && isLambdaHandler(current)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Lambda network call without timeout',
          `\`${callText}()\` inside Lambda handler has no \`timeout=\` parameter — network calls without timeouts can cause Lambda functions to hang until the function timeout.`,
          sourceCode,
          'Add a `timeout=` parameter to the network call (e.g. `timeout=5`).',
        )
      }
      current = current.parent
    }
    return null
  },
}
