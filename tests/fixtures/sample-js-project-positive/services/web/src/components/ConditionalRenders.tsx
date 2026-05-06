/**
 * React component with multiple `cond && <X/>` JSX branches. Each
 * `{cond && <X/>}` is an independent expression — they should not be
 * summed into one "complex expression" finding for the variable
 * declarator. The rule's `countOps` recursed through the entire JSX
 * subtree of the declarator's value, accumulating &&s from every
 * conditional render across the component.
 *
 * Mirrors documenso's
 *   apps/remix/app/components/dialogs/ai-field-detection-dialog.tsx:61, :162
 *   apps/remix/app/components/dialogs/envelope-distribute-dialog.tsx:78
 */

interface Props {
  readonly showA: boolean;
  readonly showB: boolean;
  readonly showC: boolean;
  readonly showD: boolean;
  readonly showE: boolean;
  readonly showF: boolean;
  readonly showG: boolean;
}

// Variable declarator whose value is an arrow function: rule walks the
// arrow body and counts every && / || in the JSX it returns.
export const ConditionalRenders = ({ showA, showB, showC, showD, showE, showF, showG }: Props): JSX.Element => {
  return (
    <div>
      {showA && <span>A</span>}
      {showB && <span>B</span>}
      {showC && <span>C</span>}
      {showD && <span>D</span>}
      {showE && <span>E</span>}
      {showF && <span>F</span>}
      {showG && <span>G</span>}
    </div>
  );
};
