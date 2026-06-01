import { GitBranch } from 'lucide-react';

/**
 * The current git branch, shown with a branch icon. Shared by the page Header
 * (analyze) and the verify actions so both render the branch identically.
 */
export function BranchLabel({ branch }: { branch?: string | null }) {
  if (!branch) return null;
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <GitBranch className="h-3.5 w-3.5" />
      {branch}
    </span>
  );
}
