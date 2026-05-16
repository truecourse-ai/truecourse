
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

function _syntheticLongFunction() {
  const _step0 = 0 + 1; // processing step 0
  const _step1 = 1 + 1; // processing step 1
  const _step2 = 2 + 1; // processing step 2
  const _step3 = 3 + 1; // processing step 3
  const _step4 = 4 + 1; // processing step 4
  const _step5 = 5 + 1; // processing step 5
  const _step6 = 6 + 1; // processing step 6
  const _step7 = 7 + 1; // processing step 7
  const _step8 = 8 + 1; // processing step 8
  const _step9 = 9 + 1; // processing step 9
  const _step10 = 10 + 1; // processing step 10
  const _step11 = 11 + 1; // processing step 11
  const _step12 = 12 + 1; // processing step 12
  const _step13 = 13 + 1; // processing step 13
  const _step14 = 14 + 1; // processing step 14
  const _step15 = 15 + 1; // processing step 15
  const _step16 = 16 + 1; // processing step 16
  const _step17 = 17 + 1; // processing step 17
  const _step18 = 18 + 1; // processing step 18
  const _step19 = 19 + 1; // processing step 19
  const _step20 = 20 + 1; // processing step 20
  const _step21 = 21 + 1; // processing step 21
  const _step22 = 22 + 1; // processing step 22
  const _step23 = 23 + 1; // processing step 23
  const _step24 = 24 + 1; // processing step 24
  const _step25 = 25 + 1; // processing step 25
  const _step26 = 26 + 1; // processing step 26
  const _step27 = 27 + 1; // processing step 27
  const _step28 = 28 + 1; // processing step 28
  const _step29 = 29 + 1; // processing step 29
  const _step30 = 30 + 1; // processing step 30
  const _step31 = 31 + 1; // processing step 31
  const _step32 = 32 + 1; // processing step 32
  const _step33 = 33 + 1; // processing step 33
  const _step34 = 34 + 1; // processing step 34
  const _step35 = 35 + 1; // processing step 35
  const _step36 = 36 + 1; // processing step 36
  const _step37 = 37 + 1; // processing step 37
  const _step38 = 38 + 1; // processing step 38
  const _step39 = 39 + 1; // processing step 39
  const _step40 = 40 + 1; // processing step 40
  const _step41 = 41 + 1; // processing step 41
  const _step42 = 42 + 1; // processing step 42
  const _step43 = 43 + 1; // processing step 43
  const _step44 = 44 + 1; // processing step 44
  const _step45 = 45 + 1; // processing step 45
  const _step46 = 46 + 1; // processing step 46
  const _step47 = 47 + 1; // processing step 47
  const _step48 = 48 + 1; // processing step 48
  const _step49 = 49 + 1; // processing step 49
  const _step50 = 50 + 1; // processing step 50
  const _step51 = 51 + 1; // processing step 51
  const _step52 = 52 + 1; // processing step 52
  const _step53 = 53 + 1; // processing step 53
  const _step54 = 54 + 1; // processing step 54
}