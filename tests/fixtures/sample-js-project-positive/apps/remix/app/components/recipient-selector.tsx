
// --- react-readonly-props FP: primitive string prop (className?) ---
declare function cn(...args: unknown[]): string;

interface RecipientSelectorProps {
  className?: string;
  label: string;
  onSelect: (id: string) => void;
}

function RecipientSelector({ className, label, onSelect }: RecipientSelectorProps) {
  return <div className={cn('selector', className)}><span>{label}</span></div>;
}
