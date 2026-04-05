/**
 * Code quality domain Python visitors — re-exports all visitors
 * and assembles the combined array.
 */

import type { CodeRuleVisitor } from '../../../types.js'

import { pythonPrintVisitor } from './print.js'
import { pythonExplicitAnyVisitor } from './explicit-any.js'
import { pythonStarImportVisitor } from './star-import.js'
import { pythonGlobalStatementVisitor } from './global-statement.js'
import { pythonTooManyReturnStatementsVisitor } from './too-many-return-statements.js'
import { pythonCollapsibleIfVisitor } from './collapsible-if.js'
import { pythonNoEmptyFunctionVisitor } from './no-empty-function.js'
import { pythonUnnecessaryElseAfterReturnVisitor } from './unnecessary-else-after-return.js'
import { pythonCognitiveComplexityVisitor } from './cognitive-complexity.js'
import { pythonCyclomaticComplexityVisitor } from './cyclomatic-complexity.js'
import { pythonTooManyLinesVisitor } from './too-many-lines.js'
import { pythonTooManyBranchesVisitor } from './too-many-branches.js'
import { pythonDeeplyNestedFunctionsVisitor } from './deeply-nested-functions.js'
import { pythonDuplicateStringVisitor } from './duplicate-string.js'
import { pythonRedundantJumpVisitor } from './redundant-jump.js'
import { pythonNoDebuggerVisitor } from './no-debugger.js'
import { pythonRequireAwaitVisitor } from './require-await.js'
import { pythonUnusedVariableVisitor } from './unused-variable.js'
import { pythonCommentedOutCodeVisitor } from './commented-out-code.js'

export const CODE_QUALITY_PYTHON_VISITORS: CodeRuleVisitor[] = [
  pythonPrintVisitor,
  pythonExplicitAnyVisitor,
  pythonStarImportVisitor,
  pythonGlobalStatementVisitor,
  pythonTooManyReturnStatementsVisitor,
  pythonCollapsibleIfVisitor,
  pythonNoEmptyFunctionVisitor,
  pythonUnnecessaryElseAfterReturnVisitor,
  pythonCognitiveComplexityVisitor,
  pythonCyclomaticComplexityVisitor,
  pythonTooManyLinesVisitor,
  pythonTooManyBranchesVisitor,
  pythonDeeplyNestedFunctionsVisitor,
  pythonDuplicateStringVisitor,
  pythonRedundantJumpVisitor,
  pythonNoDebuggerVisitor,
  pythonRequireAwaitVisitor,
  pythonUnusedVariableVisitor,
  pythonCommentedOutCodeVisitor,
]
