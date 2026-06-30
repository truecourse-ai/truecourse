/**
 * Right-pane empty state for the Spec tab — shown when no document or
 * overlap is selected in the corpus view.
 */

export function SpecPanePlaceholder({
  message = 'Select a document or conflict from the list to view it.',
}: {
  message?: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
      <p>{message}</p>
    </div>
  );
}
