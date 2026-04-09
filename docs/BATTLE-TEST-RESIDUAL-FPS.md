# Battle Test Residual FPs — To Fix Next Session

After 9 batches (75 rules fixed), re-battle found 11 more FP patterns in previously-fixed rules.

## Residual FPs (11 rules, ~100 violations)

| Rule | Count | FP Reason | Fix |
|------|-------|-----------|-----|
| unchecked-array-access | 39 | Doesn't recognize `key in obj` as bounds check | Check preceding `in` operator |
| missing-react-memo | 22 | Flags components with hooks producing unstable refs | Skip when component has hooks that return new references each render |
| unnecessary-type-assertion | 22 | Flags `key as keyof T` narrowing (necessary) | Skip when narrowing from string to keyof |
| process-exit-in-library | 4 | Doesn't skip /scripts/ directory | Add /scripts/ to entry-point paths |
| missing-error-boundary | 3 | Flags useEffect+fetch (ErrorBoundary can't catch async) | Skip useEffect+fetch pattern, only flag useQuery/Suspense |
| missing-return-await | 2 | Flags synchronous .map() return | Verify returned expression is actually a Promise |
| function-in-loop | 2 | Flags config callbacks, not loop closures | Skip callbacks in options objects |
| unnecessary-context-provider | 2 | Doesn't recognize {children} pattern | Skip when provider body renders children prop |
| undefined-passed-as-optional | 2 | Flags useState<T | undefined>(undefined) | Skip when type explicitly includes undefined |
| missing-finally-cleanup | 1 | Flags singleton/cached resource access | Skip when resource call is a getter/singleton |

## True Positives (6 rules — leave as-is)

- react-readonly-props (27) — mutable React props
- missing-destructuring (5) — valid style suggestion  
- duplicate-import (18) — real duplicate imports
- too-many-union-members (2) — 6 members > threshold
- confusing-void-expression (1) — return undefined as T
- timing-attack-comparison (2) — real timing vulnerability
- contradictory-optional-chain (1) — real ?. then ! contradiction
