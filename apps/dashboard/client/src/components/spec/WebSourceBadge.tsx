/**
 * The "web" chip — marks a spec doc snapshotted from a registered llms.txt
 * documentation site (`truecourse spec source add`) rather than written in the
 * repo. The area-chip geometry, so it sits in the tags row like any other tag.
 */

export function WebSourceBadge({ className = '' }: { className?: string }) {
  return (
    <span className={`rounded bg-muted px-1.5 py-0.5 text-[10px] text-foreground ${className}`}>
      web
    </span>
  );
}
