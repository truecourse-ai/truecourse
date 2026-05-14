
declare function useMemo<T>(fn: () => T, deps: any[]): T;
declare function useCurrentTeam(): { url: string } | null;
declare const t: (s: TemplateStringsArray, ...a: any[]) => string;

const navLinks = useMemo(() => {
  const teamUrl = useCurrentTeam()?.url ?? null;

  if (!teamUrl) {
    return [
      { href: '/inbox', text: 'Inbox' },
      { href: '/settings/profile', text: 'Settings' },
    ];
  }

  return [
    { href: `/t/${teamUrl}/documents`, text: 'Documents' },
    { href: `/t/${teamUrl}/templates`, text: 'Templates' },
    { href: '/inbox', text: 'Inbox' },
    { href: '/settings/profile', text: 'Settings' },
  ];
}, []);
