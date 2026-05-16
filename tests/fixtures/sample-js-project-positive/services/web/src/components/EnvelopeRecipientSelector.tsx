
declare function useState<T>(init: T): [T, (v: T) => void];
declare function useCallback<T extends (...args: any[]) => any>(fn: T, deps: any[]): T;
declare const cn: (...args: any[]) => string;
declare const Avatar: any;
declare const AvatarFallback: any;
declare const AvatarImage: any;
declare const Badge: any;
declare const Button: any;
declare const Checkbox: any;
declare const Input: any;
declare const Search: any;
declare const UserCheck: any;
declare const UserX: any;

type Recipient = {
  id: string;
  name: string;
  email: string;
  role: 'SIGNER' | 'VIEWER' | 'APPROVER' | 'CC';
  avatarUrl?: string;
  signed: boolean;
};

type EnvelopeRecipientSelectorProps = {
  recipients: Recipient[];
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  className?: string;
};

const ROLE_COLOR: Record<string, string> = {
  SIGNER: 'default',
  VIEWER: 'secondary',
  APPROVER: 'outline',
  CC: 'outline',
};

export const EnvelopeRecipientSelector = ({
  recipients,
  selectedIds,
  onSelectionChange,
  className,
}: EnvelopeRecipientSelectorProps) => {
  const [search, setSearch] = useState('');

  const filtered = recipients.filter(
    (r) =>
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.email.toLowerCase().includes(search.toLowerCase()),
  );

  const handleToggle = useCallback(
    (id: string) => {
      const next = new Set(selectedIds);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      onSelectionChange(next);
    },
    [selectedIds, onSelectionChange],
  );

  const handleSelectAll = () => {
    onSelectionChange(new Set(filtered.map((r) => r.id)));
  };

  const handleClearAll = () => {
    onSelectionChange(new Set());
  };

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search recipients…"
          value={search}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
        />
      </div>

      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={handleSelectAll}>
          <UserCheck className="mr-1.5 h-4 w-4" />
          Select all
        </Button>
        <Button variant="ghost" size="sm" onClick={handleClearAll}>
          <UserX className="mr-1.5 h-4 w-4" />
          Clear
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">
          {selectedIds.size} of {recipients.length} selected
        </span>
      </div>

      <div className="space-y-2 overflow-y-auto">
        {filtered.map((recipient) => (
          <label
            key={recipient.id}
            htmlFor={`recipient-${recipient.id}`}
            className={cn(
              'flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors',
              selectedIds.has(recipient.id)
                ? 'border-primary bg-primary/5'
                : 'hover:bg-muted/40',
            )}
          >
            <Checkbox
              id={`recipient-${recipient.id}`}
              checked={selectedIds.has(recipient.id)}
              onCheckedChange={() => handleToggle(recipient.id)}
            />

            <Avatar className="h-8 w-8 shrink-0">
              <AvatarImage src={recipient.avatarUrl} />
              <AvatarFallback>
                {recipient.name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{recipient.name}</p>
              <p className="truncate text-xs text-muted-foreground">{recipient.email}</p>
            </div>

            <div className="flex items-center gap-2">
              <Badge variant={ROLE_COLOR[recipient.role] ?? 'outline'}>
                {recipient.role}
              </Badge>
              {recipient.signed && (
                <Badge variant="default">Signed</Badge>
              )}
            </div>
          </label>
        ))}

        {filtered.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No recipients match your search.
          </p>
        )}
      </div>
    </div>
  );
};



// Positive: mixed-type-imports — inline `type` modifier (TS 4.5+) mixes value and type specifiers
// in a single import statement. This is valid, idiomatic TypeScript with verbatimModuleSyntax.
declare function createMultiSelect<T>(options: T[]): { value: T | null; select: (v: T) => void };
declare function formatRecipientLabel(r: { email: string; displayName: string }): string;

// import { createMultiSelect, type RecipientOption } from '@app/ui/primitives/multi-select';
// The inline type modifier is the recommended pattern — mixing value and inline-type in one statement.
type RecipientOption = { id: string; email: string; displayName: string };

export function buildRecipientSelector(recipients: RecipientOption[]) {
  const select = createMultiSelect(recipients);
  return {
    ...select,
    label: select.value ? formatRecipientLabel(select.value) : '',
  };
}

