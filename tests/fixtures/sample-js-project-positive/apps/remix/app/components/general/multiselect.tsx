declare const cn: (...args: unknown[]) => string;
declare const Badge: (props: { children: React.ReactNode; variant?: string; className?: string }) => JSX.Element;
declare const Command: (props: { children: React.ReactNode; className?: string }) => JSX.Element;
declare const CommandInput: (props: { placeholder?: string; value?: string; onValueChange?: (v: string) => void }) => JSX.Element;
declare const CommandList: (props: { children: React.ReactNode }) => JSX.Element;
declare const CommandItem: (props: { children: React.ReactNode; value?: string; onSelect?: (v: string) => void }) => JSX.Element;
declare const CommandEmpty: (props: { children: React.ReactNode }) => JSX.Element;
declare const Popover: (props: { open?: boolean; onOpenChange?: (open: boolean) => void; children: React.ReactNode }) => JSX.Element;
declare const PopoverTrigger: (props: { children: React.ReactNode; asChild?: boolean }) => JSX.Element;
declare const PopoverContent: (props: { children: React.ReactNode; className?: string; align?: string }) => JSX.Element;
declare const X: (props: { className?: string }) => JSX.Element;
declare const Check: (props: { className?: string }) => JSX.Element;
declare const ChevronDown: (props: { className?: string }) => JSX.Element;

type MultiSelectOption = { value: string; label: string };

type MultiSelectProps = {
  options: MultiSelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  maxItems?: number;
};

export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = 'Select options...',
  disabled = false,
  className,
  maxItems,
}: MultiSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');

  const toggle = (optionValue: string) => {
    if (value.includes(optionValue)) {
      onChange(value.filter((v) => v !== optionValue));
    } else if (!maxItems || value.length < maxItems) {
      onChange([...value, optionValue]);
    }
  };

  const remove = (optionValue: string) => {
    onChange(value.filter((v) => v !== optionValue));
  };

  const filteredOptions = options.filter((o) =>
    o.label.toLowerCase().includes(search.toLowerCase()),
  );

  const selectedLabels = value
    .map((v) => options.find((o) => o.value === v)?.label)
    .filter(Boolean) as string[];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'flex min-h-9 w-full flex-wrap items-center gap-1 rounded-md border bg-background px-3 py-1.5 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
        >
          {selectedLabels.length > 0 ? (
            selectedLabels.map((label, i) => (
              <Badge key={value[i]} variant="secondary" className="gap-1">
                {label}
                <button
                  onClick={(e) => { e.stopPropagation(); remove(value[i]); }}
                  className="ml-0.5 rounded-full hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0" align="start">
        <Command>
          <CommandInput placeholder="Search..." value={search} onValueChange={setSearch} />
          <CommandList>
            {filteredOptions.length === 0 ? (
              <CommandEmpty>No options found.</CommandEmpty>
            ) : (
              filteredOptions.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  onSelect={() => toggle(option.value)}
                >
                  <Check
                    className={cn('mr-2 h-4 w-4', {
                      'opacity-100': value.includes(option.value),
                      'opacity-0': !value.includes(option.value),
                    })}
                  />
                  {option.label}
                </CommandItem>
              ))
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
