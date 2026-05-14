
declare function useState<T>(init: T): [T, (v: T) => void];
declare const cn: (...args: any[]) => string;
declare const Popover: any;
declare const PopoverContent: any;
declare const PopoverTrigger: any;
declare const Info: any;
declare const HelpCircle: any;

type FieldTooltipVariant = 'info' | 'required' | 'error';

type EnvelopeFieldTooltipProps = {
  content: string;
  variant?: FieldTooltipVariant;
  side?: 'top' | 'right' | 'bottom' | 'left';
  className?: string;
};

const VARIANT_STYLES: Record<FieldTooltipVariant, { icon: any; iconClass: string; borderClass: string }> = {
  info: {
    icon: Info,
    iconClass: 'text-muted-foreground',
    borderClass: 'border-muted',
  },
  required: {
    icon: HelpCircle,
    iconClass: 'text-primary',
    borderClass: 'border-primary/40',
  },
  error: {
    icon: Info,
    iconClass: 'text-destructive',
    borderClass: 'border-destructive/40',
  },
};

export const EnvelopeFieldTooltip = ({
  content,
  variant = 'info',
  side = 'top',
  className,
}: EnvelopeFieldTooltipProps) => {
  const [open, setOpen] = useState(false);
  const { icon: Icon, iconClass, borderClass } = VARIANT_STYLES[variant];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            className,
          )}
          aria-label="Field information"
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          onClick={() => setOpen((v) => !v)}
        >
          <Icon className={cn('h-4 w-4', iconClass)} />
        </button>
      </PopoverTrigger>

      <PopoverContent
        side={side}
        sideOffset={6}
        className={cn('max-w-[240px] border p-3 text-sm shadow-md', borderClass)}
        onOpenAutoFocus={(e: Event) => e.preventDefault()}
      >
        {content}
      </PopoverContent>
    </Popover>
  );
};
