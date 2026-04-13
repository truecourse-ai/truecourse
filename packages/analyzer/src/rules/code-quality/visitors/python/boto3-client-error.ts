import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { containsPythonIdentifierExact } from '../../../_shared/python-helpers.js'
import { importsAwsSdk } from '../../../_shared/python-framework-detection.js'

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

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Uncaught botocore ClientError',
      'boto3/botocore calls inside try block but `ClientError` is not explicitly caught — generic `except` hides AWS API errors.',
      sourceCode,
      'Add explicit `except botocore.exceptions.ClientError as e:` to handle AWS API errors.',
    )
  },
}
