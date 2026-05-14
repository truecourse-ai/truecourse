// Single component uses a Tailwind class string — one usage, not a meaningful duplicate
declare function cn(...classes: (string | undefined | null | false)[]): string;

interface FieldPlaceholderProps {
  active: boolean;
  disabled?: boolean;
}

function FieldPlaceholder({ active, disabled }: FieldPlaceholderProps) {
  const className = cn(
    'flex h-8 w-full cursor-pointer items-center justify-between rounded border px-2 text-sm',
    active && 'border-primary bg-primary/5',
    disabled && 'pointer-events-none opacity-50',
  );
  return { className };
}
