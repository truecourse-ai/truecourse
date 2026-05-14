// Single combobox component adds/removes 'mousedown' event listener — one usage
declare function useEffect(fn: () => void | (() => void), deps?: unknown[]): void;
declare const document: {
  addEventListener(event: string, handler: (e: MouseEvent) => void): void;
  removeEventListener(event: string, handler: (e: MouseEvent) => void): void;
};

function useClickOutside(ref: { current: HTMLElement | null }, onClickOutside: () => void) {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClickOutside();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
    };
  }, [ref, onClickOutside]);
}



// --- FP shape: React component returning a single JSX element; return type trivially inferred, shadcn/ui pattern ---
declare function cn(...classes: (string | undefined)[]): string;
declare interface SkeletonProps { className?: string; style?: Record<string, string> }

function Skeleton({ className, ...props }: SkeletonProps) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />;
}

export { Skeleton };



// --- FP shape: generic React component returning JSX; return type trivially inferred, codebase-wide pattern ---
declare type OptionValue = string | number;
declare interface ComboboxOption<T = OptionValue> { value: T; label: string }
declare interface MultiSelectComboboxProps<T = OptionValue> {
  options: ComboboxOption<T>[];
  selectedValues: T[];
  onChange(values: T[]): void;
  placeholder?: string;
  loading?: boolean;
}

export function MultiSelectCombobox<T = OptionValue>({
  options,
  selectedValues,
  onChange,
  placeholder,
  loading,
}: MultiSelectComboboxProps<T>) {
  return (
    <div>
      {loading && <span>Loading...</span>}
      {options.map((opt) => (
        <button key={String(opt.value)} onClick={() => onChange([...selectedValues, opt.value])}>
          {opt.label}
        </button>
      ))}
    </div>
  );
}



// --- FP shape: React component returning JSX; trivially inferred, codebase-wide pattern ---
declare function cn2(...classes: (string | undefined)[]): string;
declare interface TabsListProps2 extends Record<string, unknown> {
  children: unknown;
  className?: string;
}

export function TabsList({ children, className, ...props }: TabsListProps2) {
  return (
    <div className={cn2('flex flex-wrap border-border border-b', className)} role="tabslist" {...props}>
      {children}
    </div>
  );
}
