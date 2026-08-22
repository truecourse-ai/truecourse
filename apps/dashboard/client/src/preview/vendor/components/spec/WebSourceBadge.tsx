// PREVIEW (UI mock, fake data): delete when the one-product dashboard lands. See docs/ONE_PRODUCT_PLAN.md §3.5.
// Copied from the agentic branch's apps/dashboard/client/src/components/spec/WebSourceBadge.tsx; delete with the preview.
/**
 * The "web" chip, marks a spec doc snapshotted from a registered llms.txt
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
