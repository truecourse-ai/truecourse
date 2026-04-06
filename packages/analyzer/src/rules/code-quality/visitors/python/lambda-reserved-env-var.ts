import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// AWS Lambda reserved environment variable names
const RESERVED_ENV_VARS = new Set([
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_LAMBDA_FUNCTION_NAME',
  'AWS_LAMBDA_FUNCTION_MEMORY_SIZE',
  'AWS_LAMBDA_FUNCTION_VERSION',
  'AWS_LAMBDA_INITIALIZATION_TYPE',
  'AWS_LAMBDA_LOG_GROUP_NAME',
  'AWS_LAMBDA_LOG_STREAM_NAME',
  'AWS_LAMBDA_RUNTIME_API',
  'AWS_EXECUTION_ENV',
  'AWS_REGION',
  'AWS_DEFAULT_REGION',
  'LAMBDA_RUNTIME_DIR',
  'LAMBDA_TASK_ROOT',
  'PATH',
  'LD_LIBRARY_PATH',
  'LANG',
  'TZ',
  'PYTHONPATH',
  '_HANDLER',
  '_X_AMZN_TRACE_ID',
])

/**
 * Detects setting AWS Lambda reserved environment variables via os.environ.
 */
export const pythonLambdaReservedEnvVarVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/lambda-reserved-env-var',
  languages: ['python'],
  nodeTypes: ['assignment'],
  visit(node, filePath, sourceCode) {
    // Pattern: os.environ['RESERVED_VAR'] = ... or os.environ['RESERVED_VAR'] = ...
    const left = node.childForFieldName('left')
    if (!left || left.type !== 'subscript') return null

    const subscriptValue = left.childForFieldName('value')
    if (!subscriptValue || subscriptValue.text !== 'os.environ') return null

    const subscript = left.childForFieldName('subscript')
    if (!subscript || subscript.type !== 'string') return null

    const varName = subscript.text.slice(1, -1)
    if (!RESERVED_ENV_VARS.has(varName)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Lambda reserved environment variable overridden',
      `Setting \`os.environ['${varName}']\` overrides a reserved AWS Lambda environment variable — this may cause unexpected behavior.`,
      sourceCode,
      `Remove the override of \`${varName}\` — use a different environment variable name.`,
    )
  },
}
