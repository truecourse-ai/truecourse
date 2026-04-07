import type { CodeRuleVisitor } from '../../../types.js'

import { emptyCatchVisitor } from './empty-catch.js'
import { selfComparisonVisitor } from './self-comparison.js'
import { selfAssignmentVisitor } from './self-assignment.js'
import { assignmentInConditionVisitor } from './assignment-in-condition.js'
import { duplicateCaseVisitor } from './duplicate-case.js'
import { duplicateKeysVisitor } from './duplicate-keys.js'
import { allBranchesIdenticalVisitor } from './all-branches-identical.js'
import { constantConditionVisitor } from './constant-condition.js'
import { unreachableCodeVisitor } from './unreachable-code.js'
import { noSelfCompareVisitor } from './no-self-compare.js'
import { duplicateClassMembersVisitor } from './duplicate-class-members.js'
import { duplicateElseIfVisitor } from './duplicate-else-if.js'
import { duplicateBranchesVisitor } from './duplicate-branches.js'
import { invalidTypeofVisitor } from './invalid-typeof.js'
import { useIsNanVisitor } from './use-is-nan.js'
import { compareNegZeroVisitor } from './compare-neg-zero.js'
import { lossOfPrecisionVisitor } from './loss-of-precision.js'
import { unsafeNegationVisitor } from './unsafe-negation.js'
import { unsafeOptionalChainingVisitor } from './unsafe-optional-chaining.js'
import { unsafeFinallyVisitor } from './unsafe-finally.js'
import { fallthroughCaseVisitor } from './fallthrough-case.js'
import { forDirectionVisitor } from './for-direction.js'
import { noConstructorReturnVisitor } from './no-constructor-return.js'
import { noSetterReturnVisitor } from './no-setter-return.js'
import { noPromiseExecutorReturnVisitor } from './no-promise-executor-return.js'
import { unreachableLoopVisitor } from './unreachable-loop.js'
import { constantBinaryExpressionVisitor } from './constant-binary-expression.js'
import { loopCounterAssignmentVisitor } from './loop-counter-assignment.js'
import { unmodifiedLoopConditionVisitor } from './unmodified-loop-condition.js'
import { constReassignmentVisitor } from './const-reassignment.js'
import { classReassignmentVisitor } from './class-reassignment.js'
import { functionReassignmentVisitor } from './function-reassignment.js'
import { importReassignmentVisitor } from './import-reassignment.js'
import { getterMissingReturnVisitor } from './getter-missing-return.js'
import { missingSuperCallVisitor } from './missing-super-call.js'
import { thisBeforeSuperVisitor } from './this-before-super.js'
import { asyncPromiseExecutorVisitor } from './async-promise-executor.js'
import { emptyCharacterClassVisitor } from './empty-character-class.js'
import { invalidRegexpVisitor } from './invalid-regexp.js'
import { controlCharsInRegexVisitor } from './control-chars-in-regex.js'
import { sparseArrayVisitor } from './sparse-array.js'
import { prototypePollutionVisitor } from './prototype-pollution.js'
import { voidZeroArgumentVisitor } from './void-zero-argument.js'
import { exceptionReassignmentVisitor } from './exception-reassignment.js'
import { nullDereferenceVisitor } from './null-dereference.js'
import { symbolDescriptionVisitor } from './symbol-description.js'
import { arrayCallbackReturnVisitor } from './array-callback-return.js'
import { noInnerDeclarationsVisitor } from './no-inner-declarations.js'
import { templateCurlyInStringVisitor } from './template-curly-in-string.js'
import { awaitInLoopVisitor } from './await-in-loop.js'
import { elementOverwriteVisitor } from './element-overwrite.js'
import { unthrownErrorVisitor } from './unthrown-error.js'
import { nonExistentOperatorVisitor } from './non-existent-operator.js'
import { inOperatorOnPrimitiveVisitor } from './in-operator-on-primitive.js'
import { uselessIncrementVisitor } from './useless-increment.js'
import { ignoredReturnValueVisitor } from './ignored-return-value.js'
import { collectionSizeMischeckVisitor } from './collection-size-mischeck.js'
import { argumentsOrderMismatchVisitor } from './arguments-order-mismatch.js'
import { unexpectedMultilineVisitor } from './unexpected-multiline.js'
import { emptyCollectionAccessVisitor } from './empty-collection-access.js'
import { voidReturnValueUsedVisitor } from './void-return-value-used.js'
import { newOperatorMisuseVisitor } from './new-operator-misuse.js'
import { uselessBackreferenceVisitor } from './useless-backreference.js'
import { dissimilarTypeComparisonVisitor } from './dissimilar-type-comparison.js'
import { indexOfPositiveCheckVisitor } from './index-of-positive-check.js'
import { arrayDeleteVisitor } from './array-delete.js'
import { commaInSwitchCaseVisitor } from './comma-in-switch-case.js'
import { literalCallVisitor } from './literal-call.js'
import { prototypeBuiltinsCallVisitor } from './prototype-builtins-call.js'
import { statefulRegexVisitor } from './stateful-regex.js'
import { incorrectStringConcatVisitor } from './incorrect-string-concat.js'
import { misleadingArrayReverseVisitor } from './misleading-array-reverse.js'
import { globalThisUsageVisitor } from './global-this-usage.js'
import { inconsistentReturnVisitor } from './inconsistent-return.js'
import { misleadingCharacterClassVisitor } from './misleading-character-class.js'
import { raceConditionAssignmentVisitor } from './race-condition-assignment.js'
import { regexGroupReferenceMismatchVisitor } from './regex-group-reference-mismatch.js'
import { duplicateImportVisitor } from './duplicate-import.js'
import { constructorReturnVisitor } from './constructor-return.js'
import { setterReturnVisitor } from './setter-return.js'
import { promiseExecutorReturnVisitor } from './promise-executor-return.js'
import { emptyPatternVisitor } from './empty-pattern.js'
import { noObjCallsVisitor } from './no-obj-calls.js'
import { asyncConstructorVisitor } from './async-constructor.js'
import { globalReassignmentVisitor } from './global-reassignment.js'
import { variableRedeclarationVisitor } from './variable-redeclaration.js'
import { restrictedNameShadowingVisitor } from './restricted-name-shadowing.js'
import { caseDeclarationLeakVisitor } from './case-declaration-leak.js'
import { deleteVariableVisitor } from './delete-variable.js'
import { octalLiteralVisitor } from './octal-literal.js'
import { octalEscapeVisitor } from './octal-escape.js'
import { nonstandardDecimalEscapeVisitor } from './nonstandard-decimal-escape.js'
import { lostErrorContextVisitor } from './lost-error-context.js'
import { missingRadixVisitor } from './missing-radix.js'
import { extraArgumentsIgnoredVisitor } from './extra-arguments-ignored.js'
import { forInArrayVisitor } from './for-in-array.js'
import { onlyThrowErrorVisitor } from './only-throw-error.js'
import { reduceMissingInitialVisitor } from './reduce-missing-initial.js'
import { arraySortWithoutCompareVisitor } from './array-sort-without-compare.js'
import { contradictoryOptionalChainVisitor } from './contradictory-optional-chain.js'
import { duplicateEnumValueVisitor } from './duplicate-enum-value.js'
import { confusingNonNullAssertionVisitor } from './confusing-non-null-assertion.js'
import { extraNonNullAssertionVisitor } from './extra-non-null-assertion.js'
import { labelVariableCollisionVisitor } from './label-variable-collision.js'
import { unassignedVariableVisitor } from './unassigned-variable.js'
import { futureReservedWordVisitor } from './future-reserved-word.js'
import { labelOnNonLoopVisitor } from './label-on-non-loop.js'
import { usestateObjectMutationVisitor } from './usestate-object-mutation.js'
import { useeffectObjectDepVisitor } from './useeffect-object-dep.js'
import { conditionalHookVisitor } from './conditional-hook.js'
import { sharedMutableModuleStateVisitor } from './shared-mutable-module-state.js'
import { errorTypeAnyVisitor } from './error-type-any.js'
import { errorSwallowedInCallbackVisitor } from './error-swallowed-in-callback.js'
import { nestedTryCatchVisitor } from './nested-try-catch.js'
import { ambiguousDivRegexVisitor } from './ambiguous-div-regex.js'
import { mixedEnumValuesVisitor } from './mixed-enum-values.js'
import { unsafeDeclarationMergingVisitor } from './unsafe-declaration-merging.js'
import { tryPromiseCatchVisitor } from './try-promise-catch.js'
import { misusedNewKeywordVisitor } from './misused-new-keyword.js'
import { contradictoryNonNullCoalescingVisitor } from './contradictory-non-null-coalescing.js'
import { emptyObjectTypeVisitor } from './empty-object-type.js'
import { wrapperObjectTypeVisitor } from './wrapper-object-type.js'
import { invalidVoidTypeVisitor } from './invalid-void-type.js'
import { getterSetterTypeMismatchVisitor } from './getter-setter-type-mismatch.js'
import { fragileEnumOrderingVisitor } from './fragile-enum-ordering.js'
import { missingReturnAwaitVisitor } from './missing-return-await.js'
import { arrayCallbackMissingReturnVisitor } from './array-callback-missing-return.js'
import { redosVulnerableRegexVisitor } from './redos-vulnerable-regex.js'
import { invisibleWhitespaceVisitor } from './invisible-whitespace.js'
import { confusingIncrementDecrementVisitor } from './confusing-increment-decrement.js'
import { asyncVoidFunctionVisitor } from './async-void-function.js'
import { missingAwaitVisitor } from './missing-await.js'
import { genericErrorMessageVisitor } from './generic-error-message.js'
import { useeffectMissingDepsVisitor } from './useeffect-missing-deps.js'
import { promiseRejectNonErrorVisitor } from './promise-reject-non-error.js'
import { invariantReturnVisitor } from './invariant-return.js'
import { unboundMethodVisitor } from './unbound-method.js'
import { useBeforeDefineVisitor } from './use-before-define.js'
import { noUndefVisitor } from './no-undef.js'
import { missingErrorBoundaryVisitor } from './missing-error-boundary.js'
// Type-aware rules (TypeQueryService)
import { awaitNonThenableVisitor } from './await-non-thenable.js'
import { unhandledPromiseVisitor } from './unhandled-promise.js'
import { misusedPromiseVisitor } from './misused-promise.js'
import { misusedSpreadVisitor } from './misused-spread.js'
import { restrictPlusOperandsVisitor } from './restrict-plus-operands.js'
import { restrictTemplateExpressionsVisitor } from './restrict-template-expressions.js'
import { baseToStringVisitor } from './base-to-string.js'
import { unsafeEnumComparisonVisitor } from './unsafe-enum-comparison.js'
import { unsafeUnaryMinusVisitor } from './unsafe-unary-minus.js'
import { switchExhaustivenessVisitor } from './switch-exhaustiveness.js'
import { nonNumberArithmeticVisitor } from './non-number-arithmetic.js'
import { valuesNotConvertibleToNumberVisitor } from './values-not-convertible-to-number.js'
import { argumentTypeMismatchVisitor } from './argument-type-mismatch.js'
import { functionReturnTypeVariesVisitor } from './function-return-type-varies.js'
import { looseBooleanExpressionVisitor } from './loose-boolean-expression.js'
import { unsafeTypeAssertionVisitor } from './unsafe-type-assertion.js'
import { tsVoidReturnValueVisitor } from './ts-void-return-value.js'

export const BUGS_JS_VISITORS: CodeRuleVisitor[] = [
  emptyCatchVisitor,
  selfComparisonVisitor,
  selfAssignmentVisitor,
  assignmentInConditionVisitor,
  duplicateCaseVisitor,
  duplicateKeysVisitor,
  allBranchesIdenticalVisitor,
  constantConditionVisitor,
  unreachableCodeVisitor,
  noSelfCompareVisitor,
  duplicateClassMembersVisitor,
  duplicateElseIfVisitor,
  duplicateBranchesVisitor,
  invalidTypeofVisitor,
  useIsNanVisitor,
  compareNegZeroVisitor,
  lossOfPrecisionVisitor,
  unsafeNegationVisitor,
  unsafeOptionalChainingVisitor,
  unsafeFinallyVisitor,
  fallthroughCaseVisitor,
  forDirectionVisitor,
  noConstructorReturnVisitor,
  noSetterReturnVisitor,
  noPromiseExecutorReturnVisitor,
  unreachableLoopVisitor,
  constantBinaryExpressionVisitor,
  loopCounterAssignmentVisitor,
  unmodifiedLoopConditionVisitor,
  constReassignmentVisitor,
  classReassignmentVisitor,
  functionReassignmentVisitor,
  importReassignmentVisitor,
  getterMissingReturnVisitor,
  missingSuperCallVisitor,
  thisBeforeSuperVisitor,
  asyncPromiseExecutorVisitor,
  emptyCharacterClassVisitor,
  invalidRegexpVisitor,
  controlCharsInRegexVisitor,
  sparseArrayVisitor,
  prototypePollutionVisitor,
  voidZeroArgumentVisitor,
  exceptionReassignmentVisitor,
  nullDereferenceVisitor,
  symbolDescriptionVisitor,
  arrayCallbackReturnVisitor,
  noInnerDeclarationsVisitor,
  templateCurlyInStringVisitor,
  awaitInLoopVisitor,
  elementOverwriteVisitor,
  unthrownErrorVisitor,
  nonExistentOperatorVisitor,
  inOperatorOnPrimitiveVisitor,
  uselessIncrementVisitor,
  ignoredReturnValueVisitor,
  collectionSizeMischeckVisitor,
  argumentsOrderMismatchVisitor,
  unexpectedMultilineVisitor,
  emptyCollectionAccessVisitor,
  voidReturnValueUsedVisitor,
  newOperatorMisuseVisitor,
  uselessBackreferenceVisitor,
  dissimilarTypeComparisonVisitor,
  indexOfPositiveCheckVisitor,
  arrayDeleteVisitor,
  commaInSwitchCaseVisitor,
  literalCallVisitor,
  prototypeBuiltinsCallVisitor,
  statefulRegexVisitor,
  incorrectStringConcatVisitor,
  misleadingArrayReverseVisitor,
  globalThisUsageVisitor,
  inconsistentReturnVisitor,
  misleadingCharacterClassVisitor,
  raceConditionAssignmentVisitor,
  regexGroupReferenceMismatchVisitor,
  duplicateImportVisitor,
  constructorReturnVisitor,
  setterReturnVisitor,
  promiseExecutorReturnVisitor,
  emptyPatternVisitor,
  noObjCallsVisitor,
  asyncConstructorVisitor,
  globalReassignmentVisitor,
  variableRedeclarationVisitor,
  restrictedNameShadowingVisitor,
  caseDeclarationLeakVisitor,
  deleteVariableVisitor,
  octalLiteralVisitor,
  octalEscapeVisitor,
  nonstandardDecimalEscapeVisitor,
  lostErrorContextVisitor,
  missingRadixVisitor,
  extraArgumentsIgnoredVisitor,
  forInArrayVisitor,
  onlyThrowErrorVisitor,
  reduceMissingInitialVisitor,
  arraySortWithoutCompareVisitor,
  contradictoryOptionalChainVisitor,
  duplicateEnumValueVisitor,
  confusingNonNullAssertionVisitor,
  extraNonNullAssertionVisitor,
  labelVariableCollisionVisitor,
  unassignedVariableVisitor,
  futureReservedWordVisitor,
  labelOnNonLoopVisitor,
  usestateObjectMutationVisitor,
  useeffectObjectDepVisitor,
  conditionalHookVisitor,
  sharedMutableModuleStateVisitor,
  errorTypeAnyVisitor,
  errorSwallowedInCallbackVisitor,
  nestedTryCatchVisitor,
  ambiguousDivRegexVisitor,
  mixedEnumValuesVisitor,
  unsafeDeclarationMergingVisitor,
  tryPromiseCatchVisitor,
  misusedNewKeywordVisitor,
  contradictoryNonNullCoalescingVisitor,
  emptyObjectTypeVisitor,
  wrapperObjectTypeVisitor,
  invalidVoidTypeVisitor,
  getterSetterTypeMismatchVisitor,
  fragileEnumOrderingVisitor,
  missingReturnAwaitVisitor,
  arrayCallbackMissingReturnVisitor,
  redosVulnerableRegexVisitor,
  invisibleWhitespaceVisitor,
  confusingIncrementDecrementVisitor,
  asyncVoidFunctionVisitor,
  missingAwaitVisitor,
  genericErrorMessageVisitor,
  useeffectMissingDepsVisitor,
  promiseRejectNonErrorVisitor,
  invariantReturnVisitor,
  unboundMethodVisitor,
  // Data-flow rules (Tier 1)
  useBeforeDefineVisitor,
  noUndefVisitor,
  missingErrorBoundaryVisitor,
  // Type-aware rules (TypeQueryService)
  awaitNonThenableVisitor,
  unhandledPromiseVisitor,
  misusedPromiseVisitor,
  misusedSpreadVisitor,
  restrictPlusOperandsVisitor,
  restrictTemplateExpressionsVisitor,
  baseToStringVisitor,
  unsafeEnumComparisonVisitor,
  unsafeUnaryMinusVisitor,
  switchExhaustivenessVisitor,
  nonNumberArithmeticVisitor,
  valuesNotConvertibleToNumberVisitor,
  argumentTypeMismatchVisitor,
  functionReturnTypeVariesVisitor,
  looseBooleanExpressionVisitor,
  unsafeTypeAssertionVisitor,
  tsVoidReturnValueVisitor,
]
