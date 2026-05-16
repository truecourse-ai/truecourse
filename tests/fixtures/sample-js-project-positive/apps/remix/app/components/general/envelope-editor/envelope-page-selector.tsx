
// FP: Plain React component with destructured props — no inline type narrowing; rule misfired on function signature
declare function cn(...classes: (string | undefined | false)[]): string;
declare const Plural: React.FC<{ value: number; one: string; other: string }>;
declare const useCurrentLayout: () => { isCompact: boolean };

type EnvelopePageSelectorProps = {
  pageNumber: number;
  primaryLabel: React.ReactNode;
  secondaryLabel: React.ReactNode;
  isSelected: boolean;
  buttonProps: React.ButtonHTMLAttributes<HTMLButtonElement>;
  badgeSlot?: React.ReactNode;
};

export const EnvelopePageSelector = ({
  pageNumber,
  primaryLabel,
  secondaryLabel,
  isSelected,
  buttonProps,
  badgeSlot,
}: EnvelopePageSelectorProps) => {
  const { isCompact } = useCurrentLayout();

  return (
    <button
      title={typeof primaryLabel === 'string' ? primaryLabel : undefined}
      className={cn(
        'group flex h-fit max-w-72 flex-shrink-0 cursor-pointer items-center space-x-3 rounded-lg border px-4 py-3 transition-colors',
        isSelected
          ? 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-400/30 dark:bg-blue-400/10 dark:text-blue-400'
          : 'border-border bg-card hover:border-primary/30',
      )}
      {...buttonProps}
    >
      <span
        className={cn(
          'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold',
          isSelected ? 'bg-blue-500 text-white' : 'bg-muted text-muted-foreground',
        )}
      >
        {pageNumber}
      </span>

      {!isCompact && (
        <div className="min-w-0 flex-1 text-left">
          <p className="truncate text-sm font-medium leading-none">{primaryLabel}</p>
          <p className="text-muted-foreground mt-1 truncate text-xs">{secondaryLabel}</p>
        </div>
      )}

      {badgeSlot && (
        <span className="ml-auto flex-shrink-0">{badgeSlot}</span>
      )}
    </button>
  );
};
