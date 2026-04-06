import type { CodeRuleVisitor } from '../../../types.js'

export { barrelFileReExportAllVisitor } from './barrel-file-re-export-all.js'

import { barrelFileReExportAllVisitor } from './barrel-file-re-export-all.js'

export const ARCHITECTURE_JS_VISITORS: CodeRuleVisitor[] = [
  barrelFileReExportAllVisitor,
]
