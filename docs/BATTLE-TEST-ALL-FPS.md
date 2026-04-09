# Battle Test — Complete False Positive Report

Battle tested against dealist project. 3581 total violations, ~301 false positives across 39 rules.

## Summary by Rule

| # | Rule | Total | FP | FP% | Fix |
|---|------|-------|-----|-----|-----|
| 1 | function-return-type-varies | 89 | ~85 | 96% | Skip when all return branches use the same constructor (NextResponse.json) |
| 2 | async-void-function | 42 | ~30 | 71% | Skip useEffect(() => { asyncFn(); }) pattern |
| 3 | unused-function-parameter | 24 | 19 | 79% | Skip Next.js route `request` param when followed by `params`; skip `public readonly` constructor params |
| 4 | dot-notation-enforcement | 18 | 18 | 100% | Skip bracket access on Record<string, T> types |
| 5 | duplicate-import (arch) | 16 | 15 | 94% | Skip when one is `import type` and other is `import value` from same module |
| 6 | ungrouped-shorthand-properties | 10 | 10 | 100% | Increase threshold (4+ transitions, 5+ properties) |
| 7 | missing-unique-constraint | 12 | 9 | 75% | Check actual schema for existing unique constraints before flagging |
| 8 | cross-service-internal-import | 8 | 8 | 100% | Resolve @/ path aliases to actual file paths before comparing services |
| 9 | unbounded-array-growth | 9 | 7 | 78% | Skip when push is inside a bounded loop (for/while with finite iteration) |
| 10 | unused-scope-definition | 8 | 7 | 88% | Recognize shorthand property usage ({ varName }) as a read |
| 11 | unnamed-regex-capture | 18 | 6 | 33% | Skip alternation-only groups like (\?|$) |
| 12 | empty-function | 6 | 6 | 100% | Skip .catch(() => {}) pattern |
| 13 | no-empty-function | 6 | 6 | 100% | Same as above |
| 14 | unnecessary-boolean-compare | 6 | 6 | 100% | Skip strict === comparisons (only flag loose ==) |
| 15 | await-non-thenable | 6 | 6 | 100% | Skip method calls on external library types |
| 16 | type-guard-preference | 5 | 5 | 100% | Skip complex functions, only flag single-check narrowing functions |
| 17 | missing-usememo-expensive | 5 | 5 | 100% | Skip static data, trivial operations, server-side code |
| 18 | inconsistent-return | 7 | 5 | 71% | Skip exhaustive switches and functions where all paths return/throw |
| 19 | static-method-candidate | 7 | 5 | 71% | Skip methods in classes that extend/implement |
| 20 | ts-declaration-style | 4 | 4 | 100% | Skip interfaces with extends clause |
| 21 | dead-method | 15 | 4 | 27% | Recognize event handler binding and interface implementations |
| 22 | default-case-in-switch | 3 | 3 | 100% | Skip exhaustive switches over known union/enum types |
| 23 | missing-destructuring | 5 | 3 | 60% | Skip destructuring from `as any` expressions |
| 24 | missing-null-check-after-find | 3 | 3 | 100% | Skip when .find() result accessed via optional chaining (?.) |
| 25 | state-update-in-loop | 2 | 2 | 100% | Skip functional setState updater (React 18+ batches) |
| 26 | hardcoded-url | 8 | 2 | 25% | Skip URLs in placeholder/aria attributes |
| 27 | star-import | 2 | 2 | 100% | Skip namespace imports for chart/UI libraries |
| 28 | html-table-accessibility | 2 | 2 | 100% | Skip generic/reusable table components with props |
| 29 | unused-constructor-result | 2 | 2 | 100% | Skip new URL() used for validation |
| 30 | useeffect-missing-deps | 7 | 2 | 29% | Skip refs (.current access) and functions defined inside effect |
| 31 | complex-type-alias | 1 | 1 | 100% | Skip simple string literal unions |
| 32 | indexed-loop-over-for-of | 1 | 1 | 100% | Skip when loop uses arithmetic on .length |
| 33 | unnecessary-type-parameter | 1 | 1 | 100% | Skip when type parameter is used by callers |
| 34 | unused-collection | 1 | 1 | 100% | Recognize collection reassignment + return as usage |
| 35 | constant-binary-expression | 1 | 1 | 100% | Skip runtime ternaries on nullable variables |
| 36 | too-many-union-members | 2 | 1 | 50% | Skip externally-defined protocol enums |
| 37 | regex-complexity | 4 | 1 | 25% | Skip standard patterns (UUID regex) |
| 38 | clear-text-protocol | 1 | 1 | 100% | Skip string comparisons that don't make connections |
| 39 | insecure-random | 1 | 1 | 100% | Skip non-security contexts |

## True Positive Rules (0% FP)

All violations verified as genuine issues: missing-return-type (311), magic-number (257), unsafe-any-usage (245), missing-boundary-types (201), sorting-style (197), inline-object-in-jsx-prop (188), too-many-lines (131), loose-boolean-expression (127), inline-function-in-jsx-prop (116), unknown-catch-variable (101), await-in-loop (94), cyclomatic-complexity (71), expression-complexity (64), catch-without-error-type (64), require-unicode-regexp (58), unsafe-type-assertion (51), duplicate-string (50), cognitive-complexity (49), magic-string (47), require-await (41), floating-promise (38), mixed-type-imports (34), readonly-parameter-types (34), declarations-in-global-scope (34), env-in-library-code (33), non-null-assertion (33), nested-ternary (29), prefer-template (29), max-nesting-depth (28), react-readonly-props (27), console-log (24), nested-template-literal (24), elseif-without-else (20), react-unstable-key (20), useless-concat (18), missing-env-validation (13), promise-all-no-error-handling (23), http-call-no-timeout (13), too-many-branches (12), no-explicit-any (11), too-many-return-statements (10), unsafe-json-parse (4), missing-error-event-handler (3), unchecked-optional-chain-depth (1), type-assertion-overuse (27), unused-import-arch (18), unused-export (17), deeply-nested-logic (8), too-many-parameters (5), data-layer-depends-on-api (4), god-service (4), long-method (2), external-layer-depends-on-api (1), god-module (1), whitespace-formatting (2), sensitive-data-in-url (7), disabled-auto-escaping (2), timing-attack-comparison (2), missing-transaction (31), empty-catch (18), generic-error-message (14), missing-radix (7), restrict-template-expressions (5), prototype-pollution (4), duplicate-import-bugs (2), contradictory-optional-chain (1), misleading-array-reverse (1), shared-mutable-module-state (1), switch-exhaustiveness (1), regex-in-loop (3), json-parse-in-loop (1), collapsible-if (7), unnecessary-else-after-return (7), redundant-template-expression (6), prefer-immediate-return (4), unused-variable (4), mutable-private-member (3), required-type-annotations (3), max-statements-per-function (2), negated-condition (2), confusing-void-expression (1), inferrable-types (1), prefer-const (1), prefer-regex-exec (1), prefer-single-boolean-return (1), todo-fixme (1), undef-init (1), undefined-assignment (1)
