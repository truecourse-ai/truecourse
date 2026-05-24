/**
 * Two shapes that the rule should not flag:
 *
 * 1. A variable declarator (or return) whose RHS is itself a
 *    function — the function body's operators belong to nested
 *    statements, which are visited separately. Counting them at the
 *    outer declarator double-counts and inflates the score past the
 *    threshold for reasons unrelated to the declarator itself.
 * 2. A `return (<JSX/>)` expression — JSX naturally uses `&&` for
 *    conditional composition; counting those as boolean-expression
 *    operators reads declarative markup as tangled boolean logic.
 */

declare const flagA: boolean;
declare const flagB: boolean;
declare const flagC: boolean;
declare const flagD: boolean;
declare const flagE: boolean;
declare const flagF: boolean;
declare const flagG: boolean;

export const collectGateErrors = (input: number): readonly string[] => {
  const errors: string[] = [];
  if (input < 0 || input > 1000) errors.push('range');
  if (input === 0 && flagA && flagB) errors.push('zero');
  if (flagC || flagD || flagE) errors.push('flagged');
  return errors;
};

export function GateBanner(): JSX.Element {
  return (
    <div>
      {flagA && <span>a</span>}
      {flagB && <span>b</span>}
      {flagC && <span>c</span>}
      {flagD && <span>d</span>}
      {flagE && <span>e</span>}
      {flagF && <span>f</span>}
      {flagG && <span>g</span>}
    </div>
  );
}
