/**
 * Code quality domain JavaScript/TypeScript visitors — re-exports all visitors
 * and assembles the combined array.
 */

import type { CodeRuleVisitor } from '../../../types.js'

import { consoleLogVisitor } from './console-log.js'
import { noExplicitAnyVisitor } from './no-explicit-any.js'
import { jsStarImportVisitor } from './star-import.js'
import { jsVarDeclarationVisitor } from './global-statement.js'
import { nestedTernaryVisitor } from './nested-ternary.js'
import { nestedTemplateLiteralVisitor } from './nested-template-literal.js'
import { tooManyReturnStatementsVisitor } from './too-many-return-statements.js'
import { collapsibleIfVisitor } from './collapsible-if.js'
import { redundantBooleanVisitor } from './redundant-boolean.js'
import { unnecessaryElseAfterReturnVisitor } from './unnecessary-else-after-return.js'
import { jsNoEmptyFunctionVisitor } from './no-empty-function.js'
import { noUselessCatchVisitor } from './no-useless-catch.js'
import { preferTemplateLiteralVisitor } from './prefer-template-literal.js'
import { noVarDeclarationVisitor } from './no-var-declaration.js'
import { cognitiveComplexityVisitor } from './cognitive-complexity.js'
import { cyclomaticComplexityVisitor } from './cyclomatic-complexity.js'
import { tooManyLinesVisitor } from './too-many-lines.js'
import { tooManyBranchesVisitor } from './too-many-branches.js'
import { nestedSwitchVisitor } from './nested-switch.js'
import { deeplyNestedFunctionsVisitor } from './deeply-nested-functions.js'
import { duplicateStringVisitor } from './duplicate-string.js'
import { unusedExpressionVisitor } from './unused-expression.js'
import { redundantJumpVisitor } from './redundant-jump.js'
import { noScriptUrlVisitor } from './no-script-url.js'
import { noThrowLiteralVisitor } from './no-throw-literal.js'
import { noLabelVarVisitor } from './no-label-var.js'
import { noNewWrappersVisitor } from './no-new-wrappers.js'
import { noProtoVisitor } from './no-proto.js'
import { noVoidVisitor } from './no-void.js'
import { preferConstVisitor } from './prefer-const.js'
import { noDebuggerVisitor } from './no-debugger.js'
import { noAlertVisitor } from './no-alert.js'
import { requireAwaitVisitor } from './require-await.js'
import { noReturnAwaitVisitor } from './no-return-await.js'
import { expressionComplexityVisitor } from './expression-complexity.js'
import { tooManySwitchCasesVisitor } from './too-many-switch-cases.js'
import { tooManyUnionMembersVisitor } from './too-many-union-members.js'
import { tooManyBreaksVisitor } from './too-many-breaks.js'
import { identicalFunctionsVisitor } from './identical-functions.js'
import { unusedVariableVisitor } from './unused-variable.js'
import { unusedPrivateMemberVisitor } from './unused-private-member.js'
import { deadStoreVisitor } from './dead-store.js'
import { unusedCollectionVisitor } from './unused-collection.js'
import { redundantAssignmentVisitor } from './redundant-assignment.js'
import { noLonelyIfVisitor } from './no-lonely-if.js'
import { uselessConstructorVisitor } from './useless-constructor.js'
import { uselessEscapeVisitor } from './useless-escape.js'
import { uselessRenameVisitor } from './useless-rename.js'
import { uselessComputedKeyVisitor } from './useless-computed-key.js'
import { uselessConcatVisitor } from './useless-concat.js'
import { strictEqualityVisitor } from './strict-equality.js'
import { commentedOutCodeVisitor } from './commented-out-code.js'
import { invertedBooleanVisitor } from './inverted-boolean.js'
import { preferSingleBooleanReturnVisitor } from './prefer-single-boolean-return.js'
import { preferImmediateReturnVisitor } from './prefer-immediate-return.js'
import { preferWhileVisitor } from './prefer-while.js'
import { preferObjectSpreadVisitor } from './prefer-object-spread.js'
import { preferOptionalChainVisitor } from './prefer-optional-chain.js'
import { preferNullishCoalescingVisitor } from './prefer-nullish-coalescing.js'
import { preferRestParamsVisitor } from './prefer-rest-params.js'
import { preferSpreadVisitor } from './prefer-spread.js'
import { parameterReassignmentVisitor } from './parameter-reassignment.js'
import { labelsUsageVisitor } from './labels-usage.js'
import { extendNativeVisitor } from './extend-native.js'
import { arrayConstructorVisitor } from './array-constructor.js'
import { functionInLoopVisitor } from './function-in-loop.js'
import { multiAssignVisitor } from './multi-assign.js'
import { bitwiseInBooleanVisitor } from './bitwise-in-boolean.js'
import { forInWithoutFilterVisitor } from './for-in-without-filter.js'
import { withStatementVisitor } from './with-statement.js'
import { defaultCaseLastVisitor } from './default-case-last.js'
import { elseifWithoutElseVisitor } from './elseif-without-else.js'
import { accessorPairsVisitor } from './accessor-pairs.js'
import { noReturnAssignVisitor } from './no-return-assign.js'
import { noSequencesVisitor } from './no-sequences.js'
import { noCallerVisitor } from './no-caller.js'
import { noIteratorVisitor } from './no-iterator.js'
import { requireYieldVisitor } from './require-yield.js'
import { classPrototypeAssignmentVisitor } from './class-prototype-assignment.js'
import { functionInBlockVisitor } from './function-in-block.js'
import { redundantTypeAliasVisitor } from './redundant-type-alias.js'
import { redundantOptionalVisitor } from './redundant-optional.js'
import { duplicateTypeConstituentVisitor } from './duplicate-type-constituent.js'
import { equalsInForTerminationVisitor } from './equals-in-for-termination.js'
import { preferIncludesVisitor } from './prefer-includes.js'
import { banTsCommentVisitor } from './ban-ts-comment.js'
import { nonNullAssertionVisitor } from './non-null-assertion.js'
import { unnecessaryBooleanCompareVisitor } from './unnecessary-boolean-compare.js'
import { unnecessaryBlockVisitor } from './unnecessary-block.js'
import { unnecessaryCallApplyVisitor } from './unnecessary-call-apply.js'
import { regexEmptyGroupVisitor } from './regex-empty-group.js'
import { regexEmptyRepetitionVisitor } from './regex-empty-repetition.js'
import { regexSingleCharClassVisitor } from './regex-single-char-class.js'
import { regexSingleCharAlternationVisitor } from './regex-single-char-alternation.js'
import { regexDuplicateCharClassVisitor } from './regex-duplicate-char-class.js'
import { regexUnusedGroupVisitor } from './regex-unused-group.js'
import { regexAnchorPrecedenceVisitor } from './regex-anchor-precedence.js'
import { preferRegexExecVisitor } from './prefer-regex-exec.js'
import { caseWithoutBreakVisitor } from './case-without-break.js'
import { undefinedPassedAsOptionalVisitor } from './undefined-passed-as-optional.js'
import { undefinedAssignmentVisitor } from './undefined-assignment.js'
import { associativeArrayVisitor } from './associative-array.js'
import { selectorParameterVisitor } from './selector-parameter.js'
import { stringComparisonVisitor } from './string-comparison.js'
import { unnecessaryBindVisitor } from './unnecessary-bind.js'
import { implicitTypeCoercionVisitor } from './implicit-type-coercion.js'
import { deepCallbackNestingVisitor } from './deep-callback-nesting.js'
import { tooManyClassesPerFileVisitor } from './too-many-classes-per-file.js'
import { noExtraneousClassVisitor } from './no-extraneous-class.js'
import { defaultParameterPositionVisitor } from './default-parameter-position.js'
import { unnamedRegexCaptureVisitor } from './unnamed-regex-capture.js'
import { unnecessaryRegexConstructorVisitor } from './unnecessary-regex-constructor.js'
import { ungroupedAccessorPairVisitor } from './ungrouped-accessor-pair.js'
import { thisAliasingVisitor } from './this-aliasing.js'
import { requireImportVisitor } from './require-import.js'
import { namespaceUsageVisitor } from './namespace-usage.js'
import { unsafeFunctionTypeVisitor } from './unsafe-function-type.js'
import { redundantTypeConstraintVisitor } from './redundant-type-constraint.js'
import { literalAssertionOverConstVisitor } from './literal-assertion-over-const.js'
import { indexedLoopOverForOfVisitor } from './indexed-loop-over-for-of.js'
import { interfaceOverFunctionTypeVisitor } from './interface-over-function-type.js'
import { filterFirstOverFindVisitor } from './filter-first-over-find.js'
import { substringOverStartsEndsVisitor } from './substring-over-starts-ends.js'
import { tripleSlashReferenceVisitor } from './triple-slash-reference.js'
import { computedEnumValueVisitor } from './computed-enum-value.js'
import { uselessEmptyExportVisitor } from './useless-empty-export.js'
import { unknownCatchVariableVisitor } from './unknown-catch-variable.js'
import { redundantTemplateExpressionVisitor } from './redundant-template-expression.js'
import { dynamicDeleteVisitor } from './dynamic-delete.js'
import { ungroupedShorthandPropertiesVisitor } from './ungrouped-shorthand-properties.js'
import { publicStaticReadonlyVisitor } from './public-static-readonly.js'
import { uselessTypeIntersectionVisitor } from './useless-type-intersection.js'
import { regexEmptyAlternativeVisitor } from './regex-empty-alternative.js'
import { regexUnicodeAwarenessVisitor } from './regex-unicode-awareness.js'
import { multilineBlockWithoutBracesVisitor } from './multiline-block-without-braces.js'
import { negatedConditionVisitor } from './negated-condition.js'
import { verboseObjectConstructorVisitor } from './verbose-object-constructor.js'
import { trivialTernaryVisitor } from './trivial-ternary.js'
import { legacyHasOwnPropertyVisitor } from './legacy-has-own-property.js'
import { unusedConstructorResultVisitor } from './unused-constructor-result.js'
import { emptyStaticBlockVisitor } from './empty-static-block.js'
import { collapsibleElseIfVisitor } from './collapsible-else-if.js'
import { trivialSwitchVisitor } from './trivial-switch.js'
import { regexMultipleSpacesVisitor } from './regex-multiple-spaces.js'
import { regexEmptyAfterReluctantVisitor } from './regex-empty-after-reluctant.js'
import { unusedFunctionParameterVisitor } from './unused-function-parameter.js'
import { hardcodedUrlVisitor } from './hardcoded-url.js'
import { hardcodedPortVisitor } from './hardcoded-port.js'
import { missingEnvValidationVisitor } from './missing-env-validation.js'
import { booleanParameterDefaultVisitor } from './boolean-parameter-default.js'
import { unnecessaryPromiseWrapVisitor } from './unnecessary-promise-wrap.js'
import { explicitAnyInReturnVisitor } from './explicit-any-in-return.js'
import { meaninglessVoidOperatorVisitor } from './meaningless-void-operator.js'
import { testWithHardcodedTimeoutVisitor } from './test-with-hardcoded-timeout.js'
import { disabledTestTimeoutVisitor } from './disabled-test-timeout.js'
import { misleadingSameLineConditionalVisitor } from './misleading-same-line-conditional.js'
import { magicNumberVisitor } from './magic-number.js'
import { asyncPromiseFunctionVisitor } from './async-promise-function.js'
import { filenameClassMismatchVisitor } from './filename-class-mismatch.js'
import { symbolDescriptionVisitor } from './symbol-description.js'
import { defaultCaseInSwitchVisitor } from './default-case-in-switch.js'
import { dotNotationEnforcementVisitor } from './dot-notation-enforcement.js'
import { maxNestingDepthVisitor } from './max-nesting-depth.js'
import { maxStatementsPerFunctionVisitor } from './max-statements-per-function.js'
import { unnecessaryLabelVisitor } from './unnecessary-label.js'
import { implicitGlobalDeclarationVisitor } from './implicit-global-declaration.js'
import { undefInitVisitor } from './undef-init.js'
import { undefinedAsIdentifierVisitor } from './undefined-as-identifier.js'
import { requireUnicodeRegexpVisitor } from './require-unicode-regexp.js'
import { inferrableTypesVisitor } from './inferrable-types.js'
import { mixedTypeImportsVisitor } from './mixed-type-imports.js'
import { mixedTypeExportsVisitor } from './mixed-type-exports.js'
import { missingReturnTypeVisitor } from './missing-return-type.js'
import { missingBoundaryTypesVisitor } from './missing-boundary-types.js'
import { uselessDefaultAssignmentVisitor } from './useless-default-assignment.js'
import { typeImportSideEffectsVisitor } from './type-import-side-effects.js'
import { testExclusiveVisitor } from './test-exclusive.js'
import { testSkippedVisitor } from './test-skipped.js'
import { testMissingAssertionVisitor } from './test-missing-assertion.js'
import { testEmptyFileVisitor } from './test-empty-file.js'
import { testInvertedArgumentsVisitor } from './test-inverted-arguments.js'
import { testSameArgumentVisitor } from './test-same-argument.js'
import { reactLeakedRenderVisitor } from './react-leaked-render.js'
import { reactHookSetterInBodyVisitor } from './react-hook-setter-in-body.js'
import { reactUselessSetStateVisitor } from './react-useless-set-state.js'
import { reactUnstableKeyVisitor } from './react-unstable-key.js'
import { reactReadonlyPropsVisitor } from './react-readonly-props.js'
import { preferTemplateVisitor } from './prefer-template.js'
import { regexComplexityVisitor } from './regex-complexity.js'
import { regexConciseVisitor } from './regex-concise.js'
import { missingDestructuringVisitor } from './missing-destructuring.js'
import { preferObjectLiteralVisitor } from './prefer-object-literal.js'
import { magicStringVisitor } from './magic-string.js'
import { reduceTypeCastVisitor } from './reduce-type-cast.js'
import { unnecessaryParameterPropertyAssignmentVisitor } from './unnecessary-parameter-property-assignment.js'
import { testIncompleteAssertionVisitor } from './test-incomplete-assertion.js'
import { testCodeAfterDoneVisitor } from './test-code-after-done.js'
import { testMissingExceptionCheckVisitor } from './test-missing-exception-check.js'
import { testDeterministicAssertionVisitor } from './test-deterministic-assertion.js'
import { htmlTableAccessibilityVisitor } from './html-table-accessibility.js'
import { jsUselessCatchVisitor } from './useless-catch.js'
import { jsDebuggerStatementVisitor } from './debugger-statement.js'
import { jsAlertUsageVisitor } from './alert-usage.js'
import { jsEmptyFunctionVisitor } from './empty-function.js'
import { jsPrimitiveWrapperVisitor } from './primitive-wrapper.js'
import { mutablePrivateMemberVisitor } from './mutable-private-member.js'
import { inconsistentFunctionCallVisitor } from './inconsistent-function-call.js'
import { testModifyingGlobalStateVisitor } from './test-modifying-global-state.js'
import { redundantOverloadVisitor } from './redundant-overload.js'
import { typeGuardPreferenceVisitor } from './type-guard-preference.js'
import { variableShadowingVisitor } from './variable-shadowing.js'
import { implicitGlobalVisitor } from './implicit-global.js'
import { blockScopedVarVisitor } from './block-scoped-var.js'
import { unusedPrivateMethodVisitor } from './unused-private-method.js'
import { unusedPrivateNestedClassVisitor } from './unused-private-nested-class.js'
import { unreadPrivateAttributeVisitor } from './unread-private-attribute.js'
import { unusedScopeDefinitionVisitor } from './unused-scope-definition.js'
import { deprecatedApiUsageVisitor } from './deprecated-api-usage.js'
import { envInLibraryCodeVisitor } from './env-in-library-code.js'
import { internalApiUsageVisitor } from './internal-api-usage.js'
import { flakyTestVisitor } from './flaky-test.js'
import { staticMethodCandidateVisitor } from './static-method-candidate.js'
import { requiredTypeAnnotationsVisitor } from './required-type-annotations.js'
import { restrictedApiUsageVisitor } from './restricted-api-usage.js'
import { restrictedTypesVisitor } from './restricted-types.js'

export const CODE_QUALITY_JS_VISITORS: CodeRuleVisitor[] = [
  consoleLogVisitor,
  noExplicitAnyVisitor,
  jsStarImportVisitor,
  jsVarDeclarationVisitor,
  nestedTernaryVisitor,
  nestedTemplateLiteralVisitor,
  tooManyReturnStatementsVisitor,
  collapsibleIfVisitor,
  redundantBooleanVisitor,
  unnecessaryElseAfterReturnVisitor,
  jsNoEmptyFunctionVisitor,
  noUselessCatchVisitor,
  preferTemplateLiteralVisitor,
  noVarDeclarationVisitor,
  cognitiveComplexityVisitor,
  cyclomaticComplexityVisitor,
  tooManyLinesVisitor,
  tooManyBranchesVisitor,
  nestedSwitchVisitor,
  deeplyNestedFunctionsVisitor,
  duplicateStringVisitor,
  unusedExpressionVisitor,
  redundantJumpVisitor,
  noScriptUrlVisitor,
  noThrowLiteralVisitor,
  noLabelVarVisitor,
  noNewWrappersVisitor,
  noProtoVisitor,
  noVoidVisitor,
  preferConstVisitor,
  noDebuggerVisitor,
  noAlertVisitor,
  requireAwaitVisitor,
  noReturnAwaitVisitor,
  expressionComplexityVisitor,
  tooManySwitchCasesVisitor,
  tooManyUnionMembersVisitor,
  tooManyBreaksVisitor,
  identicalFunctionsVisitor,
  unusedVariableVisitor,
  unusedPrivateMemberVisitor,
  deadStoreVisitor,
  unusedCollectionVisitor,
  redundantAssignmentVisitor,
  noLonelyIfVisitor,
  uselessConstructorVisitor,
  uselessEscapeVisitor,
  uselessRenameVisitor,
  uselessComputedKeyVisitor,
  uselessConcatVisitor,
  strictEqualityVisitor,
  commentedOutCodeVisitor,
  invertedBooleanVisitor,
  preferSingleBooleanReturnVisitor,
  preferImmediateReturnVisitor,
  preferWhileVisitor,
  preferObjectSpreadVisitor,
  preferOptionalChainVisitor,
  preferNullishCoalescingVisitor,
  // Batch 3
  preferRestParamsVisitor,
  preferSpreadVisitor,
  parameterReassignmentVisitor,
  labelsUsageVisitor,
  extendNativeVisitor,
  arrayConstructorVisitor,
  functionInLoopVisitor,
  multiAssignVisitor,
  bitwiseInBooleanVisitor,
  forInWithoutFilterVisitor,
  withStatementVisitor,
  defaultCaseLastVisitor,
  elseifWithoutElseVisitor,
  accessorPairsVisitor,
  noReturnAssignVisitor,
  noSequencesVisitor,
  noCallerVisitor,
  noIteratorVisitor,
  requireYieldVisitor,
  classPrototypeAssignmentVisitor,
  functionInBlockVisitor,
  redundantTypeAliasVisitor,
  redundantOptionalVisitor,
  duplicateTypeConstituentVisitor,
  equalsInForTerminationVisitor,
  // Batch 4
  preferIncludesVisitor,
  banTsCommentVisitor,
  nonNullAssertionVisitor,
  unnecessaryBooleanCompareVisitor,
  unnecessaryBlockVisitor,
  unnecessaryCallApplyVisitor,
  regexEmptyGroupVisitor,
  regexEmptyRepetitionVisitor,
  regexSingleCharClassVisitor,
  regexSingleCharAlternationVisitor,
  regexDuplicateCharClassVisitor,
  regexUnusedGroupVisitor,
  regexAnchorPrecedenceVisitor,
  preferRegexExecVisitor,
  caseWithoutBreakVisitor,
  undefinedPassedAsOptionalVisitor,
  undefinedAssignmentVisitor,
  associativeArrayVisitor,
  selectorParameterVisitor,
  stringComparisonVisitor,
  unnecessaryBindVisitor,
  implicitTypeCoercionVisitor,
  deepCallbackNestingVisitor,
  tooManyClassesPerFileVisitor,
  noExtraneousClassVisitor,
  // Batch 5
  defaultParameterPositionVisitor,
  unnamedRegexCaptureVisitor,
  unnecessaryRegexConstructorVisitor,
  ungroupedAccessorPairVisitor,
  thisAliasingVisitor,
  requireImportVisitor,
  namespaceUsageVisitor,
  unsafeFunctionTypeVisitor,
  redundantTypeConstraintVisitor,
  literalAssertionOverConstVisitor,
  indexedLoopOverForOfVisitor,
  interfaceOverFunctionTypeVisitor,
  filterFirstOverFindVisitor,
  substringOverStartsEndsVisitor,
  tripleSlashReferenceVisitor,
  computedEnumValueVisitor,
  uselessEmptyExportVisitor,
  unknownCatchVariableVisitor,
  redundantTemplateExpressionVisitor,
  dynamicDeleteVisitor,
  ungroupedShorthandPropertiesVisitor,
  publicStaticReadonlyVisitor,
  uselessTypeIntersectionVisitor,
  regexEmptyAlternativeVisitor,
  regexUnicodeAwarenessVisitor,
  // Batch 6
  multilineBlockWithoutBracesVisitor,
  negatedConditionVisitor,
  verboseObjectConstructorVisitor,
  trivialTernaryVisitor,
  legacyHasOwnPropertyVisitor,
  unusedConstructorResultVisitor,
  emptyStaticBlockVisitor,
  collapsibleElseIfVisitor,
  trivialSwitchVisitor,
  regexMultipleSpacesVisitor,
  regexEmptyAfterReluctantVisitor,
  unusedFunctionParameterVisitor,
  hardcodedUrlVisitor,
  hardcodedPortVisitor,
  missingEnvValidationVisitor,
  booleanParameterDefaultVisitor,
  unnecessaryPromiseWrapVisitor,
  explicitAnyInReturnVisitor,
  meaninglessVoidOperatorVisitor,
  testWithHardcodedTimeoutVisitor,
  disabledTestTimeoutVisitor,
  misleadingSameLineConditionalVisitor,
  magicNumberVisitor,
  asyncPromiseFunctionVisitor,
  filenameClassMismatchVisitor,
  // Batch 7
  symbolDescriptionVisitor,
  // Batch 8
  defaultCaseInSwitchVisitor,
  dotNotationEnforcementVisitor,
  maxNestingDepthVisitor,
  maxStatementsPerFunctionVisitor,
  unnecessaryLabelVisitor,
  implicitGlobalDeclarationVisitor,
  undefInitVisitor,
  undefinedAsIdentifierVisitor,
  requireUnicodeRegexpVisitor,
  inferrableTypesVisitor,
  mixedTypeImportsVisitor,
  mixedTypeExportsVisitor,
  missingReturnTypeVisitor,
  missingBoundaryTypesVisitor,
  uselessDefaultAssignmentVisitor,
  typeImportSideEffectsVisitor,
  testExclusiveVisitor,
  testSkippedVisitor,
  testMissingAssertionVisitor,
  testEmptyFileVisitor,
  testInvertedArgumentsVisitor,
  testSameArgumentVisitor,
  reactLeakedRenderVisitor,
  reactHookSetterInBodyVisitor,
  reactUselessSetStateVisitor,
  reactUnstableKeyVisitor,
  reactReadonlyPropsVisitor,
  // Batch 9 — new JS/TS rules from first 106 unimplemented
  preferTemplateVisitor,
  regexComplexityVisitor,
  regexConciseVisitor,
  missingDestructuringVisitor,
  preferObjectLiteralVisitor,
  magicStringVisitor,
  // Batch 10 — second half of remaining rules
  reduceTypeCastVisitor,
  unnecessaryParameterPropertyAssignmentVisitor,
  testIncompleteAssertionVisitor,
  testCodeAfterDoneVisitor,
  testMissingExceptionCheckVisitor,
  testDeterministicAssertionVisitor,
  htmlTableAccessibilityVisitor,
  // Batch 11 — first half of remaining new rules
  jsUselessCatchVisitor,
  jsDebuggerStatementVisitor,
  jsAlertUsageVisitor,
  jsEmptyFunctionVisitor,
  jsPrimitiveWrapperVisitor,
  mutablePrivateMemberVisitor,
  inconsistentFunctionCallVisitor,
  testModifyingGlobalStateVisitor,
  redundantOverloadVisitor,
  typeGuardPreferenceVisitor,
  // Data-flow rules (Tier 1 + Tier 2)
  variableShadowingVisitor,
  implicitGlobalVisitor,
  blockScopedVarVisitor,
  unusedPrivateMethodVisitor,
  unusedPrivateNestedClassVisitor,
  unreadPrivateAttributeVisitor,
  unusedScopeDefinitionVisitor,
  deprecatedApiUsageVisitor,
  envInLibraryCodeVisitor,
  internalApiUsageVisitor,
  flakyTestVisitor,
  staticMethodCandidateVisitor,
  requiredTypeAnnotationsVisitor,
  restrictedApiUsageVisitor,
  restrictedTypesVisitor,
]
