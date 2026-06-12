import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName, getCSharpReceiver } from '../../../_shared/csharp-helpers.js'

/**
 * `Environment.GetEnvironmentVariable` deep in domain/service code. In .NET
 * the composition root (Program.cs / Startup.cs) and configuration classes
 * are the env-bootstrap surface; everything else should receive settings via
 * IConfiguration / the options pattern.
 */
const ALLOWED_FILES = new Set(['program.cs', 'startup.cs', 'globalusings.cs'])

const ALLOWED_NAME_PARTS = [
  'config', 'settings', 'options', 'environment', 'secrets', 'bootstrap', 'launch',
]

const ALLOWED_PATH_PARTS = ['/configuration/', '/config/', '/properties/']

/** Test files by filename convention (XTests.cs, XFixture.cs, test_*). */
const TEST_FILE_NAME = /(?:tests?|fixture)\.cs$|(?:^|\.)(?:test|fixture)/i

export const csharpEnvInLibraryCodeVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/env-in-library-code',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    if (getCSharpMethodName(node) !== 'GetEnvironmentVariable') return null
    const receiver = getCSharpReceiver(node)
    if (receiver !== 'Environment' && !receiver.endsWith('.Environment')) return null

    const lowerPath = filePath.toLowerCase()
    const fileName = lowerPath.split('/').pop() ?? ''
    if (ALLOWED_FILES.has(fileName)) return null
    if (ALLOWED_NAME_PARTS.some((part) => fileName.includes(part))) return null
    if (ALLOWED_PATH_PARTS.some((part) => lowerPath.includes(part))) return null
    if (TEST_FILE_NAME.test(fileName)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Environment variable read in non-config code',
      'Direct `Environment.GetEnvironmentVariable` access in library/domain code — configuration should be injected (IConfiguration / options pattern), not read ad hoc.',
      sourceCode,
      'Move the environment read to the composition root or a configuration class and inject the value via IOptions<T> / IConfiguration.',
    )
  },
}
