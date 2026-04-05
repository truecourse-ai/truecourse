import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const OS_PATH_METHODS = new Set([
  'abspath', 'basename', 'commonpath', 'commonprefix', 'dirname', 'exists',
  'expanduser', 'expandvars', 'getatime', 'getctime', 'getmtime', 'getsize',
  'isabs', 'isdir', 'isfile', 'islink', 'ismount', 'join', 'lexists',
  'normcase', 'normpath', 'realpath', 'relpath', 'samefile', 'sameopenfile',
  'samestat', 'split', 'splitdrive', 'splitext',
])

const OS_METHODS = new Set([
  'mkdir', 'makedirs', 'rename', 'renames', 'replace', 'rmdir', 'remove',
  'unlink', 'chmod', 'stat', 'getcwd', 'listdir', 'symlink', 'readlink',
])

export const pythonPreferPathlibVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/prefer-pathlib',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    if (fn.type === 'attribute') {
      const obj = fn.childForFieldName('object')
      const attr = fn.childForFieldName('attribute')
      if (!obj || !attr) return null

      // os.path.xxx(...)
      if (obj.type === 'attribute') {
        const outerObj = obj.childForFieldName('object')
        const outerAttr = obj.childForFieldName('attribute')
        if (outerObj?.text === 'os' && outerAttr?.text === 'path' && OS_PATH_METHODS.has(attr.text)) {
          return makeViolation(
            this.ruleKey, node, filePath, 'low',
            `Prefer pathlib over os.path.${attr.text}`,
            `\`os.path.${attr.text}()\` should use \`pathlib.Path\` methods for modern, readable path handling.`,
            sourceCode,
            `Replace with \`pathlib.Path(...).${attr.text}()\` or equivalent.`,
          )
        }
      }

      // os.xxx(...)
      if (obj.type === 'identifier' && obj.text === 'os' && OS_METHODS.has(attr.text)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          `Prefer pathlib over os.${attr.text}`,
          `\`os.${attr.text}()\` should use \`pathlib.Path\` methods for modern, readable path handling.`,
          sourceCode,
          `Replace with the equivalent \`pathlib.Path\` method.`,
        )
      }

      // glob.glob(...)
      if (obj.type === 'identifier' && obj.text === 'glob' && attr.text === 'glob') {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Prefer pathlib over glob.glob',
          '`glob.glob()` should use `pathlib.Path.glob()` for modern path handling.',
          sourceCode,
          'Replace with `pathlib.Path(...).glob(pattern)`.',
        )
      }
    }

    // builtin open() — only flag if not in with statement already (too noisy, skip)
    return null
  },
}
