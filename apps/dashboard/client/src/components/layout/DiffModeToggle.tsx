import { HoverPopover } from '@/components/ui/hover-popover';

/** Domain wording for the toggle's hint — keeps the control's structure fixed,
 * differing only in the noun/verb per surface. */
export type DiffModeSubject = {
  /** Third-person verb for the run, e.g. "analyzes". */
  verb: string;
  /** Plural noun for the findings, e.g. "violations". */
  plural: string;
};

function DiffModeHint({ subject }: { subject: DiffModeSubject }) {
  return (
    <div className="space-y-2 text-[11px] leading-relaxed">
      <div>
        <p className="font-semibold text-foreground">Normal mode</p>
        <p>
          Stashes pending changes, {subject.verb} the committed code, then restores your changes.
          The baseline is always the committed state.
        </p>
      </div>
      <div>
        <p className="font-semibold text-foreground">Git Diff mode</p>
        <p>
          Compares your working tree against the committed baseline. Shows which {subject.plural} your
          pending changes introduce or resolve.
        </p>
      </div>
    </div>
  );
}

/**
 * Normal / Git Diff segmented toggle used in the page Header. The hint text is
 * built from `subject` so the control's wording adapts to the surface's domain
 * (e.g. violations).
 */
export function DiffModeToggle({
  diffMode,
  onToggle,
  subject,
}: {
  diffMode: boolean;
  onToggle: (diff: boolean) => void;
  subject: DiffModeSubject;
}) {
  return (
    <HoverPopover align="end" width="wide" content={<DiffModeHint subject={subject} />}>
      <div className="flex items-center rounded-md border border-border p-0.5">
        <button
          type="button"
          onClick={() => diffMode && onToggle(false)}
          className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
            !diffMode ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Normal
        </button>
        <button
          type="button"
          onClick={() => !diffMode && onToggle(true)}
          className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
            diffMode ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Git Diff
        </button>
      </div>
    </HoverPopover>
  );
}
