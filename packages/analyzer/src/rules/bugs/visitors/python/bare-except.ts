import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonBareExceptVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/bare-except',
  languages: ['python'],
  nodeTypes: ['except_clause'],
  visit(node, filePath, sourceCode) {
    const children = node.children
    const exceptKeyword = children.find((c) => c.type === 'except')
    const colon = children.find((c) => c.text === ':')

    if (!exceptKeyword || !colon) return null

    const exceptIdx = children.findIndex((c) => c.id === exceptKeyword.id)
    const colonIdx = children.findIndex((c) => c.id === colon.id)

    const hasCatchType = children.slice(exceptIdx + 1, colonIdx).some(
      (c) => c.type === 'identifier' || c.type === 'as_pattern' || c.type === 'dotted_name'
        || c.type === 'attribute' || c.type === 'tuple'
    )

    if (!hasCatchType) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Bare except clause',
        'Bare `except:` catches all exceptions including KeyboardInterrupt and SystemExit. Use `except Exception:` instead.',
        sourceCode,
        'Replace `except:` with `except Exception:` or a more specific exception type.',
      )
    }

    const typeNode = children.slice(exceptIdx + 1, colonIdx).find((c) => c.type === 'identifier')
    if (typeNode?.text === 'BaseException') {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Bare except clause',
        '`except BaseException:` catches all exceptions including KeyboardInterrupt and SystemExit. Use `except Exception:` instead.',
        sourceCode,
        'Replace `except BaseException:` with `except Exception:` or a more specific exception type.',
      )
    }

    return null
  },
}
