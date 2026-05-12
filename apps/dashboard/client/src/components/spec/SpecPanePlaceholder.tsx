/**
 * Right-pane empty state for the Spec tab — shown when no conflict
 * or canonical file is selected. Toolbar (stats + Refresh / Accept
 * all / Apply) renders above the placeholder so the user can act on
 * the tab no matter which sub-view the sidebar is showing.
 */

import { useSpec } from './SpecContext';
import { SpecToolbar } from './SpecToolbar';
import { deriveSpecView } from './SpecPanel';

export function SpecPanePlaceholder() {
  const { scan } = useSpec();
  const view = deriveSpecView(scan);
  return (
    <div className="flex h-full flex-col">
      <SpecToolbar />
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
        <p>
          {view === 'canonical'
            ? 'Select a file from the canonical tree to view it.'
            : 'Select a conflict from the list to review its candidates.'}
        </p>
      </div>
    </div>
  );
}
