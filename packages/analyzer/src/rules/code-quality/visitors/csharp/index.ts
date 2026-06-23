import type { CodeRuleVisitor } from '../../../types.js'
import { csharpAccessorPairsVisitor } from './accessor-pairs.js'
import { csharpAmbiguousUnicodeCharacterVisitor } from './ambiguous-unicode-character.js'
import { csharpBanTsCommentVisitor } from './ban-ts-comment.js'
import { csharpBitwiseInBooleanVisitor } from './bitwise-in-boolean.js'
import { csharpBooleanTrapVisitor } from './boolean-trap.js'
import { csharpBroadExceptionRaisedVisitor } from './broad-exception-raised.js'
import { csharpCompareToEmptyStringVisitor } from './compare-to-empty-string.js'
import { csharpDeeplyNestedFstringVisitor } from './deeply-nested-fstring.js'
import { csharpEmptyStaticBlockVisitor } from './empty-static-block.js'
import { csharpEnvInLibraryCodeVisitor } from './env-in-library-code.js'
import { csharpEqWithoutHashVisitor } from './eq-without-hash.js'
import { csharpErrorInsteadOfExceptionVisitor } from './error-instead-of-exception.js'
import { csharpFilenameClassMismatchVisitor } from './filename-class-mismatch.js'
import { csharpFilterFirstOverFindVisitor } from './filter-first-over-find.js'
import { csharpIfElseInsteadOfTernaryVisitor } from './if-else-instead-of-ternary.js'
import { csharpIfExprMinMaxVisitor } from './if-expr-min-max.js'
import { csharpIndexedLoopOverForOfVisitor } from './indexed-loop-over-for-of.js'
import { csharpLabelsUsageVisitor } from './labels-usage.js'
import { csharpLenTestVisitor } from './len-test.js'
import { csharpLoggingStringFormatVisitor } from './logging-string-format.js'
import { csharpMisleadingSameLineConditionalVisitor } from './misleading-same-line-conditional.js'
import { csharpMissingEnvValidationVisitor } from './missing-env-validation.js'
import { csharpMultilineBlockWithoutBracesVisitor } from './multiline-block-without-braces.js'
import { csharpMutablePrivateMemberVisitor } from './mutable-private-member.js'
import { csharpNestedTemplateLiteralVisitor } from './nested-template-literal.js'
import { csharpNonAugmentedAssignmentVisitor } from './non-augmented-assignment.js'
import { csharpNonNullAssertionVisitor } from './non-null-assertion.js'
import { csharpOpenFileWithoutContextManagerVisitor } from './open-file-without-context-manager.js'
import { csharpPreferImmediateReturnVisitor } from './prefer-immediate-return.js'
import { csharpPreferIncludesVisitor } from './prefer-includes.js'
import { csharpPreferOptionalChainVisitor } from './prefer-optional-chain.js'
import { csharpPreferTemplateVisitor } from './prefer-template.js'
import { csharpPreferWhileVisitor } from './prefer-while.js'
import { csharpRaiseWithinTryVisitor } from './raise-within-try.js'
import { csharpReimplementedBuiltinVisitor } from './reimplemented-builtin.js'
import { csharpSubclassBuiltinCollectionVisitor } from './subclass-builtin-collection.js'
import { csharpSubstringOverStartsEndsVisitor } from './substring-over-starts-ends.js'
import { csharpUnconditionalAssertionVisitor } from './unconditional-assertion.js'
import { csharpUnnamedRegexCaptureVisitor } from './unnamed-regex-capture.js'
import { csharpUnnecessaryBlockVisitor } from './unnecessary-block.js'
import { csharpUnnecessaryRegularExpressionVisitor } from './unnecessary-regular-expression.js'
import { csharpUnreadPrivateAttributeVisitor } from './unread-private-attribute.js'
import { csharpUnusedConstructorResultVisitor } from './unused-constructor-result.js'
import { csharpUselessConcatVisitor } from './useless-concat.js'
import { csharpUselessEscapeVisitor } from './useless-escape.js'
import { csharpUselessWithLockVisitor } from './useless-with-lock.js'
import { csharpClassAsDataStructureVisitor } from './class-as-data-structure.js'
import { csharpCognitiveComplexityVisitor } from './cognitive-complexity.js'
import { csharpCollapsibleElseIfVisitor } from './collapsible-else-if.js'
import { csharpCollapsibleIfVisitor } from './collapsible-if.js'
import { csharpCommentedOutCodeVisitor } from './commented-out-code.js'
import { csharpComparisonOfConstantVisitor } from './comparison-of-constant.js'
import { csharpConsoleLogVisitor } from './console-log.js'
import { csharpContradictoryBooleanExpressionVisitor } from './contradictory-boolean-expression.js'
import { csharpCyclomaticComplexityVisitor } from './cyclomatic-complexity.js'
import { csharpDeadStoreVisitor } from './dead-store.js'
import { csharpDeprecatedApiUsageVisitor } from './deprecated-api-usage.js'
import { csharpDisabledTestTimeoutVisitor } from './disabled-test-timeout.js'
import { csharpDeeplyNestedFunctionsVisitor } from './deeply-nested-functions.js'
import { csharpDefaultCaseInSwitchVisitor } from './default-case-in-switch.js'
import { csharpDefaultCaseLastVisitor } from './default-case-last.js'
import { csharpDoubleNegationVisitor } from './double-negation.js'
import { csharpDuplicateStringVisitor } from './duplicate-string.js'
import { csharpEmptyFunctionVisitor } from './empty-function.js'
import { csharpEqualsInForTerminationVisitor } from './equals-in-for-termination.js'
import { csharpExpressionComplexityVisitor } from './expression-complexity.js'
import { csharpFlakyTestVisitor } from './flaky-test.js'
import { csharpHardcodedPortVisitor } from './hardcoded-port.js'
import { csharpHardcodedUrlVisitor } from './hardcoded-url.js'
import { csharpIdenticalFunctionsVisitor } from './identical-functions.js'
import { csharpIfWithSameArmsVisitor } from './if-with-same-arms.js'
import { csharpInvertedBooleanVisitor } from './inverted-boolean.js'
import { csharpMagicNumberVisitor } from './magic-number.js'
import { csharpMagicStringVisitor } from './magic-string.js'
import { csharpMaxNestingDepthVisitor } from './max-nesting-depth.js'
import { csharpMaxStatementsPerFunctionVisitor } from './max-statements-per-function.js'
import { csharpMultiAssignVisitor } from './multi-assign.js'
import { csharpNegatedConditionVisitor } from './negated-condition.js'
import { csharpNestedSwitchVisitor } from './nested-switch.js'
import { csharpNestedTernaryVisitor } from './nested-ternary.js'
import { csharpNoDebuggerVisitor } from './no-debugger.js'
import { csharpNoEmptyFunctionVisitor } from './no-empty-function.js'
import { csharpNoExtraneousClassVisitor } from './no-extraneous-class.js'
import { csharpNoLonelyIfVisitor } from './no-lonely-if.js'
import { csharpNoReturnAssignVisitor } from './no-return-assign.js'
import { csharpNoUselessCatchVisitor } from './no-useless-catch.js'
import { csharpParameterReassignmentVisitor } from './parameter-reassignment.js'
import { csharpPreferSingleBooleanReturnVisitor } from './prefer-single-boolean-return.js'
import { csharpRedundantJumpVisitor } from './redundant-jump.js'
import { csharpRegexAnchorPrecedenceVisitor } from './regex-anchor-precedence.js'
import { csharpRegexCharClassPreferredVisitor } from './regex-char-class-preferred.js'
import { csharpRegexComplexityVisitor } from './regex-complexity.js'
import { csharpRegexConciseVisitor } from './regex-concise.js'
import { csharpRegexDuplicateCharClassVisitor } from './regex-duplicate-char-class.js'
import { csharpRegexEmptyAfterReluctantVisitor } from './regex-empty-after-reluctant.js'
import { csharpRegexEmptyAlternativeVisitor } from './regex-empty-alternative.js'
import { csharpRegexEmptyGroupVisitor } from './regex-empty-group.js'
import { csharpRegexEmptyRepetitionVisitor } from './regex-empty-repetition.js'
import { csharpRegexMultipleSpacesVisitor } from './regex-multiple-spaces.js'
import { csharpRegexOctalEscapeVisitor } from './regex-octal-escape.js'
import { csharpRegexSingleCharAlternationVisitor } from './regex-single-char-alternation.js'
import { csharpRegexSingleCharClassVisitor } from './regex-single-char-class.js'
import { csharpRegexSuperfluousQuantifierVisitor } from './regex-superfluous-quantifier.js'
import { csharpRegexUnnecessaryNonCapturingGroupVisitor } from './regex-unnecessary-non-capturing-group.js'
import { csharpRegexUnusedGroupVisitor } from './regex-unused-group.js'
import { csharpStaticMethodCandidateVisitor } from './static-method-candidate.js'
import { csharpSuperfluousElseAfterControlVisitor } from './superfluous-else-after-control.js'
import { csharpTestEmptyFileVisitor } from './test-empty-file.js'
import { csharpTestInvertedArgumentsVisitor } from './test-inverted-arguments.js'
import { csharpTestMissingAssertionVisitor } from './test-missing-assertion.js'
import { csharpTestMissingExceptionCheckVisitor } from './test-missing-exception-check.js'
import { csharpTestModifyingGlobalStateVisitor } from './test-modifying-global-state.js'
import { csharpTestSameArgumentVisitor } from './test-same-argument.js'
import { csharpTestSkippedVisitor } from './test-skipped.js'
import { csharpTestWithHardcodedTimeoutVisitor } from './test-with-hardcoded-timeout.js'
import { csharpTooManyBooleanExpressionsVisitor } from './too-many-boolean-expressions.js'
import { csharpTooManyBranchesVisitor } from './too-many-branches.js'
import { csharpTooManyBreaksVisitor } from './too-many-breaks.js'
import { csharpTooManyClassesPerFileVisitor } from './too-many-classes-per-file.js'
import { csharpTooManyLinesVisitor } from './too-many-lines.js'
import { csharpTooManyLocalsVisitor } from './too-many-locals.js'
import { csharpTooManyNestedBlocksVisitor } from './too-many-nested-blocks.js'
import { csharpTooManyPositionalArgumentsVisitor } from './too-many-positional-arguments.js'
import { csharpTooManyPublicMethodsVisitor } from './too-many-public-methods.js'
import { csharpTooManyReturnStatementsVisitor } from './too-many-return-statements.js'
import { csharpTooManyStatementsVisitor } from './too-many-statements.js'
import { csharpTooManySwitchCasesVisitor } from './too-many-switch-cases.js'
import { csharpTrivialSwitchVisitor } from './trivial-switch.js'
import { csharpTrivialTernaryVisitor } from './trivial-ternary.js'
import { csharpUnnecessaryElseAfterReturnVisitor } from './unnecessary-else-after-return.js'
import { csharpUnnecessaryNamespaceQualifierVisitor } from './unnecessary-namespace-qualifier.js'
import { csharpUnsafeAnyUsageVisitor } from './unsafe-any-usage.js'
import { csharpUnusedCollectionVisitor } from './unused-collection.js'
import { csharpUnusedFunctionParameterVisitor } from './unused-function-parameter.js'
import { csharpUnusedPrivateMemberVisitor } from './unused-private-member.js'
import { csharpUnusedPrivateMethodVisitor } from './unused-private-method.js'
import { csharpUnusedPrivateNestedClassVisitor } from './unused-private-nested-class.js'
import { csharpUnusedVariableVisitor } from './unused-variable.js'
import { csharpUselessCatchVisitor } from './useless-catch.js'
import { csharpUselessConstructorVisitor } from './useless-constructor.js'
import { csharpYodaConditionVisitor } from './yoda-condition.js'
import { csharpAbstractClassPublicConstructorVisitor } from './abstract-class-public-constructor.js'
import { csharpAbstractClassWithoutAbstractMembersVisitor } from './abstract-class-without-abstract-members.js'
import { csharpArithmeticPrecedenceParenthesesVisitor } from './arithmetic-precedence-parentheses.js'
import { csharpAsymmetricEqualityOperatorsVisitor } from './asymmetric-equality-operators.js'
import { csharpAttributeMissingUsageVisitor } from './attribute-missing-usage.js'
import { csharpConditionalPrecedenceParenthesesVisitor } from './conditional-precedence-parentheses.js'
import { csharpCrefWithPrefixVisitor } from './cref-with-prefix.js'
import { csharpDebugAssertFalseVisitor } from './debug-assert-false.js'
import { csharpDuplicateSwitchSectionBodiesVisitor } from './duplicate-switch-section-bodies.js'
import { csharpDuplicateWordInCommentVisitor } from './duplicate-word-in-comment.js'
import { csharpEmptyCommentVisitor } from './empty-comment.js'
import { csharpEmptyElseClauseVisitor } from './empty-else-clause.js'
import { csharpEmptyInterfaceVisitor } from './empty-interface.js'
import { csharpEmptyNamespaceDeclarationVisitor } from './empty-namespace-declaration.js'
import { csharpEnumMemberPrefixedWithTypeVisitor } from './enum-member-prefixed-with-type.js'
import { csharpEnumReservedMemberNameVisitor } from './enum-reserved-member-name.js'
import { csharpExceptionNamedTypeNotExceptionVisitor } from './exception-named-type-not-exception.js'
import { csharpExceptionTypeNotPublicVisitor } from './exception-type-not-public.js'
import { csharpUnnecessaryUnaryPlusVisitor } from './unnecessary-unary-plus.js'
import { csharpNullableShorthandVisitor } from './nullable-shorthand.js'
import { csharpUnnecessaryVerbatimStringVisitor } from './unnecessary-verbatim-string.js'
import { csharpRedundantBaseConstructorCallVisitor } from './redundant-base-constructor-call.js'
import { csharpRedundantBaseTypeVisitor } from './redundant-base-type.js'
import { csharpObsoleteWithoutMessageVisitor } from './obsolete-without-message.js'
import { csharpNotImplementedExceptionVisitor } from './not-implemented-exception.js'
import { csharpUnnecessaryRecordBracesVisitor } from './unnecessary-record-braces.js'
import { csharpEnumUnderlyingTypeNotInt32Visitor } from './enum-underlying-type-not-int32.js'
import { csharpRedundantDefaultSwitchSectionVisitor } from './redundant-default-switch-section.js'
import { csharpUseNullCoalescingAssignmentVisitor } from './use-null-coalescing-assignment.js'
import { csharpUseNullCoalescingVisitor } from './use-null-coalescing.js'
import { csharpUnsealedAttributeVisitor } from './unsealed-attribute.js'
import { csharpStaticHolderTypeHasConstructorVisitor } from './static-holder-type-has-constructor.js'
import { csharpUseStringConcatOverJoinVisitor } from './use-string-concat-over-join.js'
import { csharpPreferTupleSyntaxVisitor } from './prefer-tuple-syntax.js'
import { csharpPreferLambdaOverDelegateVisitor } from './prefer-lambda-over-delegate.js'
import { csharpUseEventArgsEmptyVisitor } from './use-eventargs-empty.js'
import { csharpPreferStringEmptyVisitor } from './prefer-string-empty.js'
import { csharpInfiniteLoopNonCanonicalVisitor } from './infinite-loop-non-canonical.js'
import { csharpManualEnumeratorLoopVisitor } from './manual-enumerator-loop.js'
import { csharpRedundantToStringCallVisitor } from './redundant-tostring-call.js'
import { csharpRedundantToCharArrayCallVisitor } from './redundant-tochararray-call.js'
import { csharpStaticReadonlyShouldBeConstVisitor } from './static-readonly-should-be-const.js'
import { csharpRedundantLengthArgumentVisitor } from './redundant-length-argument.js'
import { csharpTraceWriteUsageVisitor } from './trace-write-usage.js'
import { csharpNonPrivateFieldVisitor } from './non-private-field.js'
import { csharpEnumMissingZeroValueVisitor } from './enum-missing-zero-value.js'
import { csharpRedundantAnonymousPropertyNameVisitor } from './redundant-anonymous-property-name.js'
import { csharpUnnecessaryDeclarationSemicolonVisitor } from './unnecessary-declaration-semicolon.js'
import { csharpRedundantDefaultInitializerVisitor } from './redundant-default-initializer.js'
import { csharpStringCompareToZeroVisitor } from './string-compare-to-zero.js'
import { csharpRedundantOverrideVisitor } from './redundant-override.js'
import { csharpLiteralSuffixOverCastVisitor } from './literal-suffix-over-cast.js'
import { csharpTooManyTypeParametersVisitor } from './too-many-type-parameters.js'
import { csharpPreferUnixEpochFieldVisitor } from './prefer-unix-epoch-field.js'
import { csharpNonFlagsEnumPluralNameVisitor } from './non-flags-enum-plural-name.js'
import { csharpFlagsEnumSingularNameVisitor } from './flags-enum-singular-name.js'
import { csharpUseThrowIfCancellationRequestedVisitor } from './use-throwifcancellationrequested.js'
import { csharpPropertyReturnsArrayVisitor } from './property-returns-array.js'
import { csharpNonGenericEventHandlerVisitor } from './non-generic-event-handler.js'
import { csharpOutRefParameterUsageVisitor } from './out-ref-parameter-usage.js'
import { csharpParamsNotOnOverrideVisitor } from './params-not-on-override.js'
import { csharpTooManyGenericParametersVisitor } from './too-many-generic-parameters.js'
import { csharpMergeDeclarationWithAssignmentVisitor } from './merge-declaration-with-assignment.js'
import { csharpUnnecessaryRawStringVisitor } from './unnecessary-raw-string.js'
import { csharpUnnecessaryStringInterpolationVisitor } from './unnecessary-string-interpolation.js'
import { csharpMergeableCatchClausesVisitor } from './mergeable-catch-clauses.js'
import { csharpTypeofNameOverTypeofNameVisitor } from './typeof-name-over-typeof-name.js'
import { csharpEventBeforeAfterPrefixVisitor } from './event-before-after-prefix.js'
import { csharpStaticMemberOnGenericTypeVisitor } from './static-member-on-generic-type.js'
import { csharpUseIsOverAsNullCheckVisitor } from './use-is-over-as-null-check.js'
import { csharpTypeInGlobalNamespaceVisitor } from './type-in-global-namespace.js'
import { csharpAddClarifyingParenthesesVisitor } from './add-clarifying-parentheses.js'
import { csharpAsyncMethodNamingVisitor } from './async-method-naming.js'
import { csharpEqualityOperatorOnReferenceTypeVisitor } from './equality-operator-on-reference-type.js'
import { csharpExcludeFromCoverageWithoutJustificationVisitor } from './excludefromcoverage-without-justification.js'
import { csharpExpectedExceptionAttributeVisitor } from './expected-exception-attribute.js'
import { csharpExtensionMethodOnObjectVisitor } from './extension-method-on-object.js'
import { csharpGenericParameterNotInferableVisitor } from './generic-parameter-not-inferable.js'
import { csharpIfToBooleanAssignmentVisitor } from './if-to-boolean-assignment.js'
import { csharpInSourceSuppressionVisitor } from './in-source-suppression.js'
import { csharpNativeMethodNotWrappedVisitor } from './native-method-not-wrapped.js'
import { csharpNestedGenericParameterVisitor } from './nested-generic-parameter.js'
import { csharpOutdatedBaseTypeVisitor } from './outdated-base-type.js'
import { csharpParameterDuplicatesMethodNameVisitor } from './parameter-duplicates-method-name.js'
import { csharpPreferAssemblyLoadVisitor } from './prefer-assembly-load.js'
import { csharpPropertyNameMatchesGetMethodVisitor } from './property-name-matches-get-method.js'
import { csharpPublicConstVersioningHazardVisitor } from './public-const-versioning-hazard.js'
import { csharpPublicMultidimensionalArrayParamVisitor } from './public-multidimensional-array-param.js'
import { csharpSealedClassProtectedMemberVisitor } from './sealed-class-protected-member.js'
import { csharpSuppressFinalizeWithoutFinalizerVisitor } from './suppressfinalize-without-finalizer.js'
import { csharpSuppressionWithoutJustificationVisitor } from './suppression-without-justification.js'
import { csharpTooManyLoggingCallsVisitor } from './too-many-logging-calls.js'
import { csharpUnnecessaryUnsafeContextVisitor } from './unnecessary-unsafe-context.js'
import { csharpUnusedTypeParameterVisitor } from './unused-type-parameter.js'
import { csharpUseArgumentNullExceptionThrowHelperVisitor } from './use-argumentnullexception-throwhelper.js'
import { csharpUseAutoPropertyVisitor } from './use-auto-property.js'
import { csharpUseExceptionFilterVisitor } from './use-exception-filter.js'
import { csharpUseIsNullOrEmptyVisitor } from './use-isnullorempty.js'
import { csharpUseObjectDisposedExceptionThrowHelperVisitor } from './use-objectdisposedexception-throwhelper.js'
import { csharpValueTypeEqualsWithoutOperatorVisitor } from './value-type-equals-without-operator.js'
import { csharpMissingAccessModifierVisitor } from './missing-access-modifier.js'
import { csharpPartialElementMissingAccessModifierVisitor } from './partial-element-missing-access-modifier.js'
import { csharpFilenameTypeMismatchVisitor } from './csharp-filename-type-mismatch.js'
import { csharpPreferPropertyOverMethodVisitor } from './prefer-property-over-method.js'
import { csharpGetMethodShouldBePropertyVisitor } from './get-method-should-be-property.js'
import { csharpPreferGenericsOverObjectVisitor } from './prefer-generics-over-object.js'

export const CODE_QUALITY_CSHARP_VISITORS: CodeRuleVisitor[] = [
  csharpPreferPropertyOverMethodVisitor,
  csharpGetMethodShouldBePropertyVisitor,
  csharpPreferGenericsOverObjectVisitor,
  csharpAccessorPairsVisitor,
  csharpAmbiguousUnicodeCharacterVisitor,
  csharpBanTsCommentVisitor,
  csharpBitwiseInBooleanVisitor,
  csharpBooleanTrapVisitor,
  csharpBroadExceptionRaisedVisitor,
  csharpCompareToEmptyStringVisitor,
  csharpDeeplyNestedFstringVisitor,
  csharpEmptyStaticBlockVisitor,
  csharpEnvInLibraryCodeVisitor,
  csharpEqWithoutHashVisitor,
  csharpErrorInsteadOfExceptionVisitor,
  csharpFilenameClassMismatchVisitor,
  csharpFilterFirstOverFindVisitor,
  csharpIfElseInsteadOfTernaryVisitor,
  csharpIfExprMinMaxVisitor,
  csharpIndexedLoopOverForOfVisitor,
  csharpLabelsUsageVisitor,
  csharpLenTestVisitor,
  csharpLoggingStringFormatVisitor,
  csharpMisleadingSameLineConditionalVisitor,
  csharpMissingEnvValidationVisitor,
  csharpMultilineBlockWithoutBracesVisitor,
  csharpMutablePrivateMemberVisitor,
  csharpNestedTemplateLiteralVisitor,
  csharpNonAugmentedAssignmentVisitor,
  csharpNonNullAssertionVisitor,
  csharpOpenFileWithoutContextManagerVisitor,
  csharpPreferImmediateReturnVisitor,
  csharpPreferIncludesVisitor,
  csharpPreferOptionalChainVisitor,
  csharpPreferTemplateVisitor,
  csharpPreferWhileVisitor,
  csharpRaiseWithinTryVisitor,
  csharpReimplementedBuiltinVisitor,
  csharpSubclassBuiltinCollectionVisitor,
  csharpSubstringOverStartsEndsVisitor,
  csharpUnconditionalAssertionVisitor,
  csharpUnnamedRegexCaptureVisitor,
  csharpUnnecessaryBlockVisitor,
  csharpUnnecessaryRegularExpressionVisitor,
  csharpUnreadPrivateAttributeVisitor,
  csharpUnusedConstructorResultVisitor,
  csharpUselessConcatVisitor,
  csharpUselessEscapeVisitor,
  csharpUselessWithLockVisitor,
  csharpClassAsDataStructureVisitor,
  csharpCognitiveComplexityVisitor,
  csharpCollapsibleElseIfVisitor,
  csharpCollapsibleIfVisitor,
  csharpCommentedOutCodeVisitor,
  csharpComparisonOfConstantVisitor,
  csharpConsoleLogVisitor,
  csharpContradictoryBooleanExpressionVisitor,
  csharpCyclomaticComplexityVisitor,
  csharpDeadStoreVisitor,
  csharpDeeplyNestedFunctionsVisitor,
  csharpDefaultCaseInSwitchVisitor,
  csharpDefaultCaseLastVisitor,
  csharpDeprecatedApiUsageVisitor,
  csharpDisabledTestTimeoutVisitor,
  csharpDoubleNegationVisitor,
  csharpDuplicateStringVisitor,
  csharpEmptyFunctionVisitor,
  csharpEqualsInForTerminationVisitor,
  csharpExpressionComplexityVisitor,
  csharpFlakyTestVisitor,
  csharpHardcodedPortVisitor,
  csharpHardcodedUrlVisitor,
  csharpIdenticalFunctionsVisitor,
  csharpIfWithSameArmsVisitor,
  csharpInvertedBooleanVisitor,
  csharpMagicNumberVisitor,
  csharpMagicStringVisitor,
  csharpMaxNestingDepthVisitor,
  csharpMaxStatementsPerFunctionVisitor,
  csharpMultiAssignVisitor,
  csharpNegatedConditionVisitor,
  csharpNestedSwitchVisitor,
  csharpNestedTernaryVisitor,
  csharpNoDebuggerVisitor,
  csharpNoEmptyFunctionVisitor,
  csharpNoExtraneousClassVisitor,
  csharpNoLonelyIfVisitor,
  csharpNoReturnAssignVisitor,
  csharpNoUselessCatchVisitor,
  csharpParameterReassignmentVisitor,
  csharpPreferSingleBooleanReturnVisitor,
  csharpRedundantJumpVisitor,
  csharpRegexAnchorPrecedenceVisitor,
  csharpRegexCharClassPreferredVisitor,
  csharpRegexComplexityVisitor,
  csharpRegexConciseVisitor,
  csharpRegexDuplicateCharClassVisitor,
  csharpRegexEmptyAfterReluctantVisitor,
  csharpRegexEmptyAlternativeVisitor,
  csharpRegexEmptyGroupVisitor,
  csharpRegexEmptyRepetitionVisitor,
  csharpRegexMultipleSpacesVisitor,
  csharpRegexOctalEscapeVisitor,
  csharpRegexSingleCharAlternationVisitor,
  csharpRegexSingleCharClassVisitor,
  csharpRegexSuperfluousQuantifierVisitor,
  csharpRegexUnnecessaryNonCapturingGroupVisitor,
  csharpRegexUnusedGroupVisitor,
  csharpStaticMethodCandidateVisitor,
  csharpSuperfluousElseAfterControlVisitor,
  csharpTestEmptyFileVisitor,
  csharpTestInvertedArgumentsVisitor,
  csharpTestMissingAssertionVisitor,
  csharpTestMissingExceptionCheckVisitor,
  csharpTestModifyingGlobalStateVisitor,
  csharpTestSameArgumentVisitor,
  csharpTestSkippedVisitor,
  csharpTestWithHardcodedTimeoutVisitor,
  csharpTooManyBooleanExpressionsVisitor,
  csharpTooManyBranchesVisitor,
  csharpTooManyBreaksVisitor,
  csharpTooManyClassesPerFileVisitor,
  csharpTooManyLinesVisitor,
  csharpTooManyLocalsVisitor,
  csharpTooManyNestedBlocksVisitor,
  csharpTooManyPositionalArgumentsVisitor,
  csharpTooManyPublicMethodsVisitor,
  csharpTooManyReturnStatementsVisitor,
  csharpTooManyStatementsVisitor,
  csharpTooManySwitchCasesVisitor,
  csharpTrivialSwitchVisitor,
  csharpTrivialTernaryVisitor,
  csharpUnnecessaryElseAfterReturnVisitor,
  csharpUnnecessaryNamespaceQualifierVisitor,
  csharpUnsafeAnyUsageVisitor,
  csharpUnusedCollectionVisitor,
  csharpUnusedFunctionParameterVisitor,
  csharpUnusedPrivateMemberVisitor,
  csharpUnusedPrivateMethodVisitor,
  csharpUnusedPrivateNestedClassVisitor,
  csharpUnusedVariableVisitor,
  csharpUselessCatchVisitor,
  csharpUselessConstructorVisitor,
  csharpYodaConditionVisitor,
  csharpAbstractClassPublicConstructorVisitor,
  csharpAbstractClassWithoutAbstractMembersVisitor,
  csharpArithmeticPrecedenceParenthesesVisitor,
  csharpAsymmetricEqualityOperatorsVisitor,
  csharpAttributeMissingUsageVisitor,
  csharpConditionalPrecedenceParenthesesVisitor,
  csharpCrefWithPrefixVisitor,
  csharpDebugAssertFalseVisitor,
  csharpDuplicateSwitchSectionBodiesVisitor,
  csharpDuplicateWordInCommentVisitor,
  csharpEmptyCommentVisitor,
  csharpEmptyElseClauseVisitor,
  csharpEmptyInterfaceVisitor,
  csharpEmptyNamespaceDeclarationVisitor,
  csharpEnumMemberPrefixedWithTypeVisitor,
  csharpEnumReservedMemberNameVisitor,
  csharpExceptionNamedTypeNotExceptionVisitor,
  csharpExceptionTypeNotPublicVisitor,
  csharpUnnecessaryUnaryPlusVisitor,
  csharpNullableShorthandVisitor,
  csharpUnnecessaryVerbatimStringVisitor,
  csharpRedundantBaseConstructorCallVisitor,
  csharpRedundantBaseTypeVisitor,
  csharpObsoleteWithoutMessageVisitor,
  csharpNotImplementedExceptionVisitor,
  csharpUnnecessaryRecordBracesVisitor,
  csharpEnumUnderlyingTypeNotInt32Visitor,
  csharpRedundantDefaultSwitchSectionVisitor,
  csharpUseNullCoalescingAssignmentVisitor,
  csharpUseNullCoalescingVisitor,
  csharpUnsealedAttributeVisitor,
  csharpStaticHolderTypeHasConstructorVisitor,
  csharpUseStringConcatOverJoinVisitor,
  csharpPreferTupleSyntaxVisitor,
  csharpPreferLambdaOverDelegateVisitor,
  csharpUseEventArgsEmptyVisitor,
  csharpPreferStringEmptyVisitor,
  csharpInfiniteLoopNonCanonicalVisitor,
  csharpManualEnumeratorLoopVisitor,
  csharpRedundantToStringCallVisitor,
  csharpRedundantToCharArrayCallVisitor,
  csharpStaticReadonlyShouldBeConstVisitor,
  csharpRedundantLengthArgumentVisitor,
  csharpTraceWriteUsageVisitor,
  csharpNonPrivateFieldVisitor,
  csharpEnumMissingZeroValueVisitor,
  csharpRedundantAnonymousPropertyNameVisitor,
  csharpUnnecessaryDeclarationSemicolonVisitor,
  csharpRedundantDefaultInitializerVisitor,
  csharpStringCompareToZeroVisitor,
  csharpRedundantOverrideVisitor,
  csharpLiteralSuffixOverCastVisitor,
  csharpTooManyTypeParametersVisitor,
  csharpPreferUnixEpochFieldVisitor,
  csharpNonFlagsEnumPluralNameVisitor,
  csharpFlagsEnumSingularNameVisitor,
  csharpUseThrowIfCancellationRequestedVisitor,
  csharpPropertyReturnsArrayVisitor,
  csharpNonGenericEventHandlerVisitor,
  csharpOutRefParameterUsageVisitor,
  csharpParamsNotOnOverrideVisitor,
  csharpTooManyGenericParametersVisitor,
  csharpMergeDeclarationWithAssignmentVisitor,
  csharpUnnecessaryRawStringVisitor,
  csharpUnnecessaryStringInterpolationVisitor,
  csharpMergeableCatchClausesVisitor,
  csharpTypeofNameOverTypeofNameVisitor,
  csharpEventBeforeAfterPrefixVisitor,
  csharpStaticMemberOnGenericTypeVisitor,
  csharpUseIsOverAsNullCheckVisitor,
  csharpTypeInGlobalNamespaceVisitor,
  csharpAddClarifyingParenthesesVisitor,
  csharpAsyncMethodNamingVisitor,
  csharpEqualityOperatorOnReferenceTypeVisitor,
  csharpExcludeFromCoverageWithoutJustificationVisitor,
  csharpExpectedExceptionAttributeVisitor,
  csharpExtensionMethodOnObjectVisitor,
  csharpGenericParameterNotInferableVisitor,
  csharpIfToBooleanAssignmentVisitor,
  csharpInSourceSuppressionVisitor,
  csharpNativeMethodNotWrappedVisitor,
  csharpNestedGenericParameterVisitor,
  csharpOutdatedBaseTypeVisitor,
  csharpParameterDuplicatesMethodNameVisitor,
  csharpPreferAssemblyLoadVisitor,
  csharpPropertyNameMatchesGetMethodVisitor,
  csharpPublicConstVersioningHazardVisitor,
  csharpPublicMultidimensionalArrayParamVisitor,
  csharpSealedClassProtectedMemberVisitor,
  csharpSuppressFinalizeWithoutFinalizerVisitor,
  csharpSuppressionWithoutJustificationVisitor,
  csharpTooManyLoggingCallsVisitor,
  csharpUnnecessaryUnsafeContextVisitor,
  csharpUnusedTypeParameterVisitor,
  csharpUseArgumentNullExceptionThrowHelperVisitor,
  csharpUseAutoPropertyVisitor,
  csharpUseExceptionFilterVisitor,
  csharpUseIsNullOrEmptyVisitor,
  csharpUseObjectDisposedExceptionThrowHelperVisitor,
  csharpValueTypeEqualsWithoutOperatorVisitor,
  csharpMissingAccessModifierVisitor,
  csharpPartialElementMissingAccessModifierVisitor,
  csharpFilenameTypeMismatchVisitor,
]
