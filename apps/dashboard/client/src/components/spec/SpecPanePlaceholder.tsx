/**
 * Right-pane empty state for the Spec tab — shown when no conflict
 * or canonical section is selected.
 */

import { useSpec } from './SpecContext';

export function SpecPanePlaceholder() {
  const { scan } = useSpec();
  const message = scan && scan.openConflicts.length === 0
    ? 'Select a section from the canonical spec to view it.'
    : 'Select a conflict from the list to review its candidates, or pick a canonical section below.';
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
      <p>{message}</p>
    </div>
  );
}
