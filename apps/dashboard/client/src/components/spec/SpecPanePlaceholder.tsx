/**
 * Right-pane empty state for the Spec tab — shown when no conflict
 * or canonical file is selected. The Spec toolbar (stats + Refresh /
 * Accept all / Apply) lives one level up as a full-width section
 * header in `RepoGraphPage`, so this view just renders the prompt.
 */

import { useSpec } from './SpecContext';
import { deriveSpecView } from './SpecPanel';

export function SpecPanePlaceholder() {
  const { scan } = useSpec();
  const view = deriveSpecView(scan);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
      <p>
        {view === 'canonical'
          ? 'Select a file from the canonical tree to view it.'
          : 'Select a conflict from the list to review its candidates.'}
      </p>
    </div>
  );
}
