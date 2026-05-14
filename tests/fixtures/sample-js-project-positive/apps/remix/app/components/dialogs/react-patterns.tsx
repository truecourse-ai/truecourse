
// --- void-zero-argument FP shape: event-handler-callback-promise-discard (onClick async) ---
// void setTemplateToPrivate(id) in onClick is intentional promise-discard, not void 0
declare function updateTemplateVisibility(templateId: string, visibility: 'public' | 'private'): Promise<void>;

function TemplateVisibilityActions({ templateId }: { templateId: string }) {
  return (
    <div>
      <button onClick={() => void updateTemplateVisibility(templateId, 'private')}>
        Make Private
      </button>
      <button onClick={() => void updateTemplateVisibility(templateId, 'public')}>
        Make Public
      </button>
    </div>
  );
}




// --- too-many-lines FP shape: react-tsx-component (JSX markup + hooks inflate line count) ---
// A standard React TSX arrow-function component whose body length exceeds the rule
// threshold purely because of JSX markup and framework hooks, not decomposable logic.
declare const useState: <T>(init: T) => [T, (v: T) => void];
declare const useMemo: <T>(fn: () => T, deps: unknown[]) => T;
declare const useEffect: (fn: () => void | (() => void), deps?: unknown[]) => void;
declare function cn(...classes: (string | Record<string, boolean>)[]): string;

type PricingTier = {
  id: string;
  label: string;
  monthlyPrice: number | null;
  yearlyPrice: number | null;
  description: string;
  highlight?: boolean;
};

type SubscriptionPlanPickerProps = {
  selectedPriceId: string;
  onSelect: (priceId: string) => void;
  tiers: Record<string, PricingTier>;
  freeSlotAvailable: boolean;
};

const SubscriptionPlanPicker = ({
  selectedPriceId,
  onSelect,
  tiers,
  freeSlotAvailable,
}: SubscriptionPlanPickerProps) => {
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('annual');

  const visibleTiers = useMemo(() => {
    return ['starter', 'growth', 'business'].map((key) => {
      const tier = tiers[key];
      return {
        id: key,
        label: tier.label,
        description: tier.description,
        monthlyPrice: tier.monthlyPrice,
        yearlyPrice: tier.yearlyPrice,
        highlight: tier.highlight ?? false,
      };
    });
  }, [tiers]);

  useEffect(() => {
    if (selectedPriceId === '' && !freeSlotAvailable) {
      const first = visibleTiers[0];
      const priceId =
        billingCycle === 'annual' ? first.yearlyPrice?.toString() : first.monthlyPrice?.toString();
      onSelect(priceId ?? '');
    }
  }, [selectedPriceId]);

  const handleCycleChange = (cycle: 'monthly' | 'annual') => {
    const currentTier = visibleTiers.find(
      (t) =>
        (billingCycle === 'annual' ? t.yearlyPrice?.toString() : t.monthlyPrice?.toString()) ===
        selectedPriceId,
    );
    setBillingCycle(cycle);
    const nextPriceId =
      cycle === 'annual'
        ? currentTier?.yearlyPrice?.toString()
        : currentTier?.monthlyPrice?.toString();
    onSelect(nextPriceId ?? Object.keys(tiers)[0]);
  };

  return (
    <div className="space-y-4">
      <div className="flex w-full items-center justify-center rounded-md border p-1">
        <button
          className={cn('w-full rounded py-1 text-sm transition-all', {
            'bg-primary text-white': billingCycle === 'monthly',
          })}
          onClick={() => handleCycleChange('monthly')}
        >
          Monthly
        </button>
        <button
          className={cn('w-full rounded py-1 text-sm transition-all', {
            'bg-primary text-white': billingCycle === 'annual',
          })}
          onClick={() => handleCycleChange('annual')}
        >
          Annually
        </button>
      </div>

      <div className="mt-4 grid gap-4 text-sm">
        <button
          onClick={() => onSelect('')}
          disabled={!freeSlotAvailable}
          className={cn(
            'flex cursor-pointer items-start space-x-2 rounded-md border p-4 transition-all hover:border-primary hover:shadow-sm',
            { 'border-primary ring-2 ring-primary/10 ring-offset-1': selectedPriceId === '' },
          )}
        >
          <div className="w-full text-left">
            <div className="flex items-center justify-between">
              <p className="font-medium">Free</p>
              <span className="ml-1.5 rounded-full bg-muted px-2 py-0.5 text-xs">
                {freeSlotAvailable ? '1 free workspace left' : '0 free workspaces left'}
              </span>
            </div>
            <div className="text-muted-foreground">Up to 3 members, 10 documents/month</div>
          </div>
        </button>

        {visibleTiers.map((tier) => {
          const activePriceId =
            billingCycle === 'annual'
              ? tier.yearlyPrice?.toString()
              : tier.monthlyPrice?.toString();
          const isSelected = activePriceId === selectedPriceId;
          return (
            <button
              key={activePriceId}
              onClick={() => onSelect(activePriceId ?? '')}
              className={cn(
                'flex cursor-pointer items-start space-x-2 rounded-md border p-4 transition-all hover:border-primary hover:shadow-sm',
                { 'border-primary ring-2 ring-primary/10 ring-offset-1': isSelected },
              )}
            >
              <div className="w-full text-left">
                <div className="flex items-center justify-between">
                  <p className="font-medium">
                    {tier.label}
                    {tier.highlight && (
                      <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                        Popular
                      </span>
                    )}
                  </p>
                  <p className="font-semibold">
                    {billingCycle === 'annual'
                      ? `$${tier.yearlyPrice ?? 0}/yr`
                      : `$${tier.monthlyPrice ?? 0}/mo`}
                  </p>
                </div>
                <div className="text-muted-foreground">{tier.description}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
