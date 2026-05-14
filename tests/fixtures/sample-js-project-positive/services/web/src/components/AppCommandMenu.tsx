
declare function useState<T>(init: T): [T, (v: T) => void];
declare function useEffect(fn: () => void | (() => void), deps?: any[]): void;
declare const useNavigate: () => (path: string) => void;
declare const useQuery: (opts: any) => { data?: any; isLoading: boolean };
declare const useDebounce: <T>(v: T, delay: number) => T;
declare const CommandDialog: any;
declare const CommandInput: any;
declare const CommandList: any;
declare const CommandEmpty: any;
declare const CommandGroup: any;
declare const CommandItem: any;
declare const CommandSeparator: any;
declare const FileText: any;
declare const LayoutDashboard: any;
declare const Settings: any;
declare const Users: any;
declare const LogOut: any;
declare const PlusCircle: any;
declare const Search: any;

type AppCommandMenuProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type SearchResult = {
  id: string;
  type: 'document' | 'template' | 'contact';
  title: string;
  subtitle?: string;
  href: string;
};

const STATIC_ACTIONS = [
  { id: 'dashboard', label: 'Go to Dashboard', icon: LayoutDashboard, href: '/dashboard' },
  { id: 'documents', label: 'All Documents', icon: FileText, href: '/documents' },
  { id: 'new-document', label: 'Create Document', icon: PlusCircle, href: '/documents/new' },
  { id: 'settings', label: 'Settings', icon: Settings, href: '/settings' },
  { id: 'team', label: 'Team Members', icon: Users, href: '/team' },
  { id: 'logout', label: 'Sign out', icon: LogOut, href: '/logout' },
];

export const AppCommandMenu = ({ open, onOpenChange }: AppCommandMenuProps) => {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 300);

  const { data: searchResults, isLoading } = useQuery({
    queryKey: ['command-search', debouncedQuery],
    enabled: debouncedQuery.length >= 2,
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        onOpenChange(true);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onOpenChange]);

  const handleSelect = (href: string) => {
    navigate(href);
    onOpenChange(false);
    setQuery('');
  };

  const results: SearchResult[] = searchResults ?? [];
  const documentResults = results.filter((r) => r.type === 'document');
  const templateResults = results.filter((r) => r.type === 'template');
  const contactResults = results.filter((r) => r.type === 'contact');

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Search documents, templates, contacts…"
        value={query}
        onValueChange={setQuery}
      />

      <CommandList>
        {isLoading && (
          <p className="px-4 py-3 text-sm text-muted-foreground">Searching…</p>
        )}

        {!isLoading && query.length >= 2 && results.length === 0 && (
          <CommandEmpty>No results for "{query}"</CommandEmpty>
        )}

        {documentResults.length > 0 && (
          <CommandGroup heading="Documents">
            {documentResults.map((result) => (
              <CommandItem
                key={result.id}
                value={`${result.type}-${result.id}`}
                onSelect={() => handleSelect(result.href)}
              >
                <FileText className="mr-2 h-4 w-4" />
                <div>
                  <p className="text-sm">{result.title}</p>
                  {result.subtitle && (
                    <p className="text-xs text-muted-foreground">{result.subtitle}</p>
                  )}
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {templateResults.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Templates">
              {templateResults.map((result) => (
                <CommandItem
                  key={result.id}
                  value={`${result.type}-${result.id}`}
                  onSelect={() => handleSelect(result.href)}
                >
                  <FileText className="mr-2 h-4 w-4 text-primary" />
                  <span className="text-sm">{result.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        <CommandSeparator />

        <CommandGroup heading="Quick actions">
          {STATIC_ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <CommandItem
                key={action.id}
                value={action.id}
                onSelect={() => handleSelect(action.href)}
              >
                <Icon className="mr-2 h-4 w-4" />
                <span className="text-sm">{action.label}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
};
