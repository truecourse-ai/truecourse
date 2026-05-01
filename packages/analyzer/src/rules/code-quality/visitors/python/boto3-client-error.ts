import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { containsPythonIdentifierExact } from '../../../_shared/python-helpers.js'
import { importsAwsSdk } from '../../../_shared/python-framework-detection.js'

// Walk the file root for `var = boto3.client(...)` / `var = boto3.resource(...)`
// (and `aiobotocore` equivalents). Returns the names that hold AWS SDK clients
// or resources so the try-body scope check can recognise calls *on* them.
function findAwsClientVarNames(root: SyntaxNode): Set<string> {
  const names = new Set<string>()
  function walk(n: SyntaxNode): void {
    if (n.type === 'assignment') {
      const lhs = n.childForFieldName('left')
      const rhs = n.childForFieldName('right')
      if (lhs?.type === 'identifier' && rhs?.type === 'call') {
        const fn = rhs.childForFieldName('function')
        if (fn?.type === 'attribute') {
          const obj = fn.childForFieldName('object')
          const attr = fn.childForFieldName('attribute')
          if (
            (obj?.text === 'boto3' || obj?.text === 'aiobotocore') &&
            (attr?.text === 'client' || attr?.text === 'resource')
          ) {
            names.add(lhs.text)
          }
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i)
      if (child) walk(child)
    }
  }
  walk(root)
  return names
}

// True if any call inside `body` is on `boto3` / `botocore` directly or on an
// identifier known to hold an AWS SDK client/resource. Without this, the rule
// fires on every try/except in a file that merely imports boto3 - including
// try blocks that wrap unrelated work like `json.loads(...)` or `Decimal(...)`.
function bodyHasAwsCall(body: SyntaxNode, awsVarNames: Set<string>): boolean {
  let found = false
  function walk(n: SyntaxNode): void {
    if (found) return
    if (n.type === 'call') {
      const fn = n.childForFieldName('function')
      if (fn?.type === 'attribute') {
        let receiver: SyntaxNode | null = fn.childForFieldName('object')
        while (receiver?.type === 'attribute') {
          receiver = receiver.childForFieldName('object')
        }
        if (receiver?.type === 'identifier') {
          const id = receiver.text
          if (id === 'boto3' || id === 'botocore' || id === 'aiobotocore' || awsVarNames.has(id)) {
            found = true
            return
          }
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i)
      if (child) walk(child)
    }
  }
  walk(body)
  return found
}

/**
 * Detects boto3/botocore calls inside try blocks where ClientError is not
 * explicitly caught — generic except may hide AWS errors.
 */
export const pythonBoto3ClientErrorVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/boto3-client-error',
  languages: ['python'],
  nodeTypes: ['try_statement'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null

    // Check if file imports an AWS SDK (boto3/botocore/aiobotocore)
    if (!importsAwsSdk(node)) return null

    // Check if any except clause catches ClientError
    const exceptClauses = node.namedChildren.filter((c) => c.type === 'except_clause')
    if (exceptClauses.length === 0) return null

    const catchesClientError = exceptClauses.some((clause) => {
      return containsPythonIdentifierExact(clause, 'ClientError')
    })

    if (catchesClientError) return null

    // Check if there's a bare except or generic Exception catch
    const hasBareOrGeneric = exceptClauses.some((clause) => {
      // Bare except: `except:` — no named children of expression type
      const exprChildren = clause.namedChildren.filter((c) =>
        c.type !== 'block' && c.type !== 'comment')
      if (exprChildren.length === 0) return true
      // Generic Exception or BaseException
      const exceptionType = exprChildren[0]
      if (!exceptionType) return true
      const typeText = exceptionType.type === 'as_pattern'
        ? exceptionType.namedChildren[0]?.text
        : exceptionType.text
      return typeText === 'Exception' || typeText === 'BaseException'
    })

    if (!hasBareOrGeneric) return null

    // Scope check: the try BODY itself must call into boto3 / botocore / a
    // known AWS SDK client variable. The file-level import alone is not
    // enough - many files use boto3 in one function and have unrelated
    // try/except blocks elsewhere.
    const awsVarNames = findAwsClientVarNames(node.tree.rootNode)
    if (!bodyHasAwsCall(body, awsVarNames)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Uncaught botocore ClientError',
      'boto3/botocore calls inside try block but `ClientError` is not explicitly caught — generic `except` hides AWS API errors.',
      sourceCode,
      'Add explicit `except botocore.exceptions.ClientError as e:` to handle AWS API errors.',
    )
  },
}
