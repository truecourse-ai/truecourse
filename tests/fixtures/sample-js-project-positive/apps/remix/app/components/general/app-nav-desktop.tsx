declare function useQuery(opts: object): { data: { count: number } | undefined; isLoading: boolean };

export function AppNavDesktop() {
  // Shared navigation component rendered across authenticated layouts.
  // Errors bubble up to the root.tsx ErrorBoundary.
  const { data: inboxData } = useQuery({ queryKey: ['inbox', 'count'] });
  const count = inboxData?.count ?? 0;

  return null;
}



// User-agent detection for macOS — /Macintosh|Mac\s+OS\s+X/i is ASCII-only strings.
export function detectModifierKey(userAgent: string): string {
  const isMacOS = /Macintosh|Mac\s+OS\s+X/i.test(userAgent);
  return isMacOS ? '\u2318' : 'Ctrl';
}
