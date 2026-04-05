import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonSubprocessPopenPreexecFnVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/subprocess-popen-preexec-fn',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const func = node.childForFieldName('function')
    if (!func) return null

    const funcText = func.text
    if (
      funcText !== 'subprocess.Popen' &&
      funcText !== 'Popen' &&
      funcText !== 'subprocess.run' &&
      funcText !== 'subprocess.call' &&
      funcText !== 'subprocess.check_call' &&
      funcText !== 'subprocess.check_output'
    ) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const preexecArg = args.namedChildren.find((arg) => {
      if (arg.type === 'keyword_argument') {
        const key = arg.childForFieldName('name')
        return key?.text === 'preexec_fn'
      }
      return false
    })

    if (!preexecArg) return null

    return makeViolation(
      this.ruleKey, preexecArg, filePath, 'medium',
      'subprocess.Popen with preexec_fn',
      `\`${funcText}\` uses \`preexec_fn\` — this is not safe in multi-threaded programs because it runs between fork() and exec() in the child process. Use \`start_new_session=True\` or other alternatives instead.`,
      sourceCode,
      'Replace `preexec_fn` with `start_new_session=True` for session management, or use `os.setpgrp` via `subprocess.Popen` arguments.',
    )
  },
}
