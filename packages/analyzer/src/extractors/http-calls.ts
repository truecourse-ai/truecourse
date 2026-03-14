import type Parser from 'tree-sitter'
import type { HttpCall, SupportedLanguage, FunctionDefinition, ClassDefinition } from '@truecourse/shared'

/**
 * Extract HTTP calls from a parsed syntax tree
 */
export function extractHttpCalls(
  tree: Parser.Tree,
  filePath: string,
  language: SupportedLanguage,
  functions: FunctionDefinition[],
  classes: ClassDefinition[]
): HttpCall[] {
  const httpCalls: HttpCall[] = []

  if (language !== 'typescript' && language !== 'javascript') {
    return httpCalls
  }

  // Build a map of line numbers to qualified names
  const lineToQualifiedName = new Map<number, string>()
  for (const func of functions) {
    lineToQualifiedName.set(func.location.startLine, func.name)
  }
  for (const cls of classes) {
    for (const method of cls.methods) {
      lineToQualifiedName.set(method.location.startLine, `${cls.name}.${method.name}`)
    }
  }

  // Traverse the tree to find fetch() and other HTTP calls
  const cursor = tree.walk()

  function traverse(): void {
    // Look for call expressions
    if (cursor.nodeType === 'call_expression') {
      const node = cursor.currentNode
      const calleeNode = node.childForFieldName('function')

      if (calleeNode) {
        const calleeName = calleeNode.text

        // Check if this is an HTTP call (fetch, axios, etc.)
        if (isHttpCall(calleeName)) {
          const httpCall = extractHttpCallDetails(node, filePath)
          if (httpCall) {
            httpCalls.push(httpCall)
          }
        }
      }
    }

    // Recurse into children
    if (cursor.gotoFirstChild()) {
      do {
        traverse()
      } while (cursor.gotoNextSibling())
      cursor.gotoParent()
    }
  }

  traverse()
  return httpCalls
}

/**
 * Check if a function name is an HTTP client call
 */
function isHttpCall(calleeName: string): boolean {
  const httpMethods = ['.get', '.post', '.put', '.delete', '.patch', '.request']

  return (
    calleeName === 'fetch' ||
    calleeName.includes('axios') ||
    calleeName.includes('http.request') ||
    calleeName.includes('https.request') ||
    // Check for HTTP method calls (this.http.get, client.post, etc.)
    httpMethods.some(method => calleeName.endsWith(method) || calleeName.includes(method + '('))
  )
}

/**
 * Extract details from an HTTP call expression
 */
function extractHttpCallDetails(
  node: Parser.SyntaxNode,
  filePath: string,
): HttpCall | null {
  const calleeNode = node.childForFieldName('function')
  const argsNode = node.childForFieldName('arguments')

  if (!calleeNode || !argsNode) {
    return null
  }

  const calleeName = calleeNode.text

  // Extract HTTP method and URL from arguments
  let method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' = 'GET'
  let url = ''
  let clientType: 'fetch' | 'axios' | 'http' | 'unknown' = 'unknown'

  // Determine client type
  if (calleeName === 'fetch') {
    clientType = 'fetch'
  } else if (calleeName.includes('axios')) {
    clientType = 'axios'
  } else if (calleeName.includes('http')) {
    clientType = 'http'
  }

  // Extract URL and method based on client type
  if (clientType === 'fetch') {
    // fetch(url, { method: 'POST', ... })
    const firstArg = argsNode.namedChild(0)
    if (firstArg) {
      url = extractStringValue(firstArg)
    }

    const secondArg = argsNode.namedChild(1)
    if (secondArg && secondArg.type === 'object') {
      const methodProp = findPropertyByName(secondArg, 'method')
      if (methodProp) {
        const m = extractStringValue(methodProp).toUpperCase()
        if (m === 'GET' || m === 'POST' || m === 'PUT' || m === 'DELETE' || m === 'PATCH') {
          method = m
        }
      }
    }
  } else if (clientType === 'axios' || clientType === 'http' || clientType === 'unknown') {
    // axios.get(url), http.get(url), client.post(url, data), etc.
    if (calleeName.includes('.get')) method = 'GET'
    else if (calleeName.includes('.post')) method = 'POST'
    else if (calleeName.includes('.put')) method = 'PUT'
    else if (calleeName.includes('.delete')) method = 'DELETE'
    else if (calleeName.includes('.patch')) method = 'PATCH'

    const firstArg = argsNode.namedChild(0)
    if (firstArg) {
      if (firstArg.type === 'object') {
        const urlProp = findPropertyByName(firstArg, 'url')
        if (urlProp) {
          url = extractStringValue(urlProp)
        }
      } else {
        url = extractStringValue(firstArg)
      }
    }
  }

  if (!url) {
    return null
  }

  return {
    method,
    url,
    location: {
      filePath,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      startColumn: node.startPosition.column,
      endColumn: node.endPosition.column,
    },
  }
}

/**
 * Extract string value from a node (handles template strings, concatenation, etc.)
 */
function extractStringValue(node: Parser.SyntaxNode): string {
  if (node.type === 'string' || node.type === 'string_fragment') {
    return node.text.replace(/^["'`]|["'`]$/g, '')
  }

  if (node.type === 'template_string') {
    // For template strings like `${baseUrl}/api/users`
    // Return the pattern with ${} markers
    return node.text
  }

  if (node.type === 'binary_expression') {
    // Handle string concatenation
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    if (left && right) {
      return extractStringValue(left) + extractStringValue(right)
    }
  }

  return node.text
}

/**
 * Find a property by name in an object literal
 */
function findPropertyByName(objectNode: Parser.SyntaxNode, propName: string): Parser.SyntaxNode | null {
  for (let i = 0; i < objectNode.namedChildCount; i++) {
    const child = objectNode.namedChild(i)
    if (child && child.type === 'pair') {
      const keyNode = child.childForFieldName('key')
      if (keyNode && keyNode.text === propName) {
        const valueNode = child.childForFieldName('value')
        return valueNode
      }
    }
  }
  return null
}
