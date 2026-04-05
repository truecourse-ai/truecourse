import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

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

    // Check if try body contains boto3/botocore calls
    const bodyText = body.text
    const hasBotoCall = bodyText.includes('boto3') || bodyText.includes('botocore') || bodyText.includes('.client(') || bodyText.includes('.resource(')
    if (!hasBotoCall) return null

    // Check if any except clause catches ClientError
    const exceptClauses = node.namedChildren.filter((c) => c.type === 'except_clause')
    if (exceptClauses.length === 0) return null

    const catchesClientError = exceptClauses.some((clause) => {
      const clauseText = clause.text
      return clauseText.includes('ClientError') || clauseText.includes('botocore.exceptions')
    })

    if (catchesClientError) return null

    // Check if there's a bare except or generic Exception catch
    const hasBareOrGeneric = exceptClauses.some((clause) => {
      const clauseText = clause.text
      return clauseText.startsWith('except:') || clauseText.includes('except Exception') || clauseText.includes('except BaseException')
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
