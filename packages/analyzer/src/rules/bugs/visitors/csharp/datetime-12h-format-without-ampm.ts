import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpStringValue } from './_regex.js'

/**
 * .NET date format strings where `hh` (12-hour clock) appears without a
 * `t`/`tt` AM/PM designator — "09:00" formats identically for 9 in the
 * morning and 9 at night.
 *
 * To stay off TimeSpan formats (where `hh` is plain elapsed hours and has
 * no AM/PM concept), the format must contain an UNESCAPED `:` — that is the
 * DateTime time separator, which a working TimeSpan format would have to
 * escape as `\:` (an escaped `:` anywhere marks the format as TimeSpan and
 * suppresses the rule).
 */
interface FormatScan {
  hasHour12: boolean
  hasAmPm: boolean
  hasColon: boolean
  hasEscapedColon: boolean
}

function scanFormat(fmt: string): FormatScan {
  const scan: FormatScan = { hasHour12: false, hasAmPm: false, hasColon: false, hasEscapedColon: false }
  for (let i = 0; i < fmt.length; i++) {
    const ch = fmt[i]
    if (ch === '\\') {
      if (fmt[i + 1] === ':') scan.hasEscapedColon = true
      i++
      continue
    }
    if (ch === "'" || ch === '"') {
      const close = fmt.indexOf(ch, i + 1)
      i = close === -1 ? fmt.length : close
      continue
    }
    if (ch === 'h') scan.hasHour12 = true
    else if (ch === 't') scan.hasAmPm = true
    else if (ch === ':') scan.hasColon = true
  }
  return scan
}

function isAmbiguous12h(fmt: string): boolean {
  const scan = scanFormat(fmt)
  return scan.hasHour12 && !scan.hasAmPm && scan.hasColon && !scan.hasEscapedColon
}

/** Format specs of composite placeholders: `{0:hh:mm}` → `hh:mm`. */
function compositeSpecs(fmt: string): string[] {
  const specs: string[] = []
  const re = /\{\d+\s*(?:,[^:}]*)?:([^{}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(fmt)) !== null) specs.push(m[1] ?? '')
  return specs
}

function firstStringArg(node: SyntaxNode, index: number): SyntaxNode | null {
  const arg = node.childForFieldName('arguments')?.namedChildren[index]
  const value = arg?.namedChildren[arg.namedChildren.length - 1]
  return value ?? null
}

export const csharpDatetime12hFormatWithoutAmpmVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/datetime-12h-format-without-ampm',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression', 'interpolated_string_expression'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'interpolated_string_expression') {
      for (const child of node.namedChildren) {
        if (child?.type !== 'interpolation') continue
        const clause = child.namedChildren.find((c) => c?.type === 'interpolation_format_clause')
        if (!clause) continue
        // Drop the leading ':'; the clause text is raw source, so a doubled
        // backslash (`hh\\:mm` in a non-verbatim string) is one escape.
        const spec = clause.text.slice(1).replace(/\\\\/g, '\\')
        if (isAmbiguous12h(spec)) {
          return makeViolation(
            this.ruleKey, child, filePath, 'high',
            'Datetime 12-hour format without AM/PM',
            `The format \`${spec}\` uses \`hh\` (12-hour clock) without a \`tt\` AM/PM designator — the output is ambiguous ("09:00" could be morning or evening).`,
            sourceCode,
            'Add `tt` to the format, or use `HH` for a 24-hour clock.',
          )
        }
      }
      return null
    }

    const fn = node.childForFieldName('function')
    if (fn?.type !== 'member_access_expression') return null
    const method = fn.childForFieldName('name')?.text ?? ''

    // dt.ToString("hh:mm") / DateTime.ParseExact(s, "hh:mm tt", culture)
    if (method === 'ToString' || method === 'ParseExact' || method === 'TryParseExact') {
      const argIndex = method === 'ToString' ? 0 : 1
      const formatArg = firstStringArg(node, argIndex)
      if (!formatArg) return null
      const fmt = getCSharpStringValue(formatArg)
      if (fmt === null || !isAmbiguous12h(fmt)) return null
      return makeViolation(
        this.ruleKey, formatArg, filePath, 'high',
        'Datetime 12-hour format without AM/PM',
        `The format string \`${fmt}\` uses \`hh\` (12-hour clock in .NET) without a \`tt\` AM/PM designator — the output is ambiguous ("09:00" could be morning or evening).`,
        sourceCode,
        'Add `tt` to the format, or use `HH` for a 24-hour clock.',
      )
    }

    // string.Format("… {0:hh:mm} …", dt)
    if (method === 'Format') {
      const receiver = fn.childForFieldName('expression')?.text ?? ''
      if (receiver !== 'string' && receiver !== 'String') return null
      const formatArg = firstStringArg(node, 0)
      if (!formatArg) return null
      const fmt = getCSharpStringValue(formatArg)
      if (fmt === null) return null
      const bad = compositeSpecs(fmt).find(isAmbiguous12h)
      if (!bad) return null
      return makeViolation(
        this.ruleKey, formatArg, filePath, 'high',
        'Datetime 12-hour format without AM/PM',
        `The placeholder format \`${bad}\` uses \`hh\` (12-hour clock in .NET) without a \`tt\` AM/PM designator — the output is ambiguous ("09:00" could be morning or evening).`,
        sourceCode,
        'Add `tt` to the placeholder format, or use `HH` for a 24-hour clock.',
      )
    }

    return null
  },
}
