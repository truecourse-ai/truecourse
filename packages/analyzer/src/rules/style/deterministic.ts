import type { AnalysisRule } from '@truecourse/shared'

export const STYLE_DETERMINISTIC_RULES: AnalysisRule[] = [
  {
    key: 'style/deterministic/comment-tag-formatting',
    category: 'code',
    domain: 'style',
    name: 'Malformed TODO/FIXME comment',
    description: 'TODO/FIXME comment without colon or description (e.g., "TODO fix this" instead of "TODO: fix this").',
    enabled: true,
    severity: 'low',
    type: 'deterministic',
  },
  {
    key: 'style/deterministic/import-formatting',
    category: 'code',
    domain: 'style',
    name: 'Import not at top of file',
    description: 'Import statement found after non-import code.',
    enabled: true,
    severity: 'low',
    type: 'deterministic',
  },
]
