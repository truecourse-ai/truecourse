
declare function useState<T>(init: T): [T, (v: T) => void];
declare function useRef<T>(init: T | null): { current: T | null };
declare function useEffect(fn: () => void | (() => void), deps?: any[]): void;
declare const useDebounce: <T>(value: T, delay: number) => T;
declare const useQuery: (opts: any) => { data?: any; isLoading: boolean };
declare const Input: any;
declare const Popover: any;
declare const PopoverAnchor: any;
declare const PopoverContent: any;
declare const Command: any;
declare const CommandEmpty: any;
declare const CommandGroup: any;
declare const CommandItem: any;
declare const Avatar: any;
declare const AvatarFallback: any;
declare const AvatarImage: any;

type ContactSuggestion = {
  email: string;
  name: string;
  avatarUrl?: string;
};

type RecipientAutocompleteInputProps = {
  value: string;
  onChange: (value: string) => void;
  onSelect: (contact: ContactSuggestion) => void;
  placeholder?: string;
  disabled?: boolean;
};

export const RecipientAutocompleteInput = ({
  value,
  onChange,
  onSelect,
  placeholder = 'Enter email or name',
  disabled = false,
}: RecipientAutocompleteInputProps) => {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debouncedQuery = useDebounce(value, 250);

  const { data: suggestions, isLoading } = useQuery({
    enabled: debouncedQuery.length >= 2,
    queryKey: ['contacts-search', debouncedQuery],
  });

  useEffect(() => {
    if (debouncedQuery.length >= 2) {
      setOpen(true);
    } else {
      setOpen(false);
    }
  }, [debouncedQuery]);

  const handleSelect = (contact: ContactSuggestion) => {
    onSelect(contact);
    onChange(contact.email);
    setOpen(false);
    inputRef.current?.focus();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Input
          ref={inputRef}
          type="email"
          value={value}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          onFocus={() => {
            if (value.length >= 2) setOpen(true);
          }}
        />
      </PopoverAnchor>

      <PopoverContent
        className="w-[320px] p-0"
        align="start"
        onOpenAutoFocus={(e: Event) => e.preventDefault()}
      >
        <Command>
          {isLoading && (
            <p className="px-4 py-3 text-sm text-muted-foreground">Searching…</p>
          )}

          {!isLoading && (
            <CommandEmpty className="px-4 py-3 text-sm">
              No contacts found
            </CommandEmpty>
          )}

          <CommandGroup>
            {(suggestions ?? []).map((contact: ContactSuggestion) => (
              <CommandItem
                key={contact.email}
                value={contact.email}
                onSelect={() => handleSelect(contact)}
                className="flex items-center gap-3 px-3 py-2"
              >
                <Avatar className="h-7 w-7">
                  <AvatarImage src={contact.avatarUrl} />
                  <AvatarFallback>
                    {contact.name.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{contact.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{contact.email}</p>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        </Command>
      </PopoverContent>
    </Popover>
  );
};


// option[groupBy] is a property access on a typed object using a generic key — not an array index
type RecipientOption = { value: string; label: string; role?: string; teamId?: number };

function groupRecipientOptions<K extends keyof RecipientOption>(
  options: RecipientOption[],
  groupBy: K,
): Map<RecipientOption[K], RecipientOption[]> {
  const grouped = new Map<RecipientOption[K], RecipientOption[]>();

  options.forEach((option) => {
    const groupValue = option[groupBy];
    const existing = grouped.get(groupValue);
    if (existing) {
      existing.push(option);
    } else {
      grouped.set(groupValue, [option]);
    }
  });

  return grouped;
}

