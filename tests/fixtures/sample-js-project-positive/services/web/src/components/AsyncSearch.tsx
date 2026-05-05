import { useEffect } from 'react';

interface AsyncSearchProps {
  readonly query: string;
  readonly open: boolean;
  readonly onSearchSync?: (q: string) => Promise<void>;
}

// Local `exec` is a user-defined async arrow function — not child_process.exec.
// The os-command-injection rule must not flag `exec()` here.
// Mirrors the FP from documenso/packages/ui/primitives/multiselect.tsx:284.
export function AsyncSearch({ query, open, onSearchSync }: AsyncSearchProps): JSX.Element | null {
  useEffect(() => {
    const exec = async (): Promise<void> => {
      if (!onSearchSync || !open) return;
      if (query.length > 0) await onSearchSync(query);
    };
    exec().catch(() => undefined);
  }, [query, open, onSearchSync]);

  return null;
}
