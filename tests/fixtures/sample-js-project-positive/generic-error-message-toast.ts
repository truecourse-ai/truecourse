// Toast-style notifications routinely pair a short, vague title ("Something
// went wrong") with a longer description that gives the user actionable
// detail. The title alone isn't a real "uninformative error" because the
// description is shown alongside it.

declare const showToast: (opts: {
  title: string;
  description: string;
  variant?: string;
}) => void;

declare const tag: (strings: TemplateStringsArray) => string;

export function notifyDeleteFailed(): void {
  showToast({
    title: 'Something went wrong',
    description: 'The document could not be deleted right now. Please try again in a moment.',
    variant: 'destructive',
  });
}

export function notifyCopyFailed(): void {
  showToast({
    title: tag`Something went wrong`,
    description: tag`The sharing link could not be created at this time. Please try again.`,
  });
}
