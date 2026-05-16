declare const Button: (props: { children: React.ReactNode; onClick?: () => void; variant?: string; disabled?: boolean; className?: string }) => JSX.Element;
declare const Badge: (props: { children: React.ReactNode; variant?: string; className?: string }) => JSX.Element;
declare const Card: (props: { children: React.ReactNode; className?: string }) => JSX.Element;
declare const CardContent: (props: { children: React.ReactNode; className?: string }) => JSX.Element;
declare const CardHeader: (props: { children: React.ReactNode }) => JSX.Element;
declare const CardTitle: (props: { children: React.ReactNode }) => JSX.Element;
declare const CardDescription: (props: { children: React.ReactNode }) => JSX.Element;
declare const CardFooter: (props: { children: React.ReactNode }) => JSX.Element;
declare const CheckCircle2: (props: { className?: string }) => JSX.Element;
declare const cn: (...args: unknown[]) => string;

type BillingInterval = 'monthly' | 'yearly';

type PlanTier = {
  id: string;
  name: string;
  price: { monthly: number; yearly: number };
  description: string;
  features: string[];
  isCurrent: boolean;
  isPopular: boolean;
};

type BillingPlansProps = {
  plans: PlanTier[];
  interval: BillingInterval;
  onIntervalChange: (v: BillingInterval) => void;
  onSelectPlan: (planId: string) => void;
  isLoading?: boolean;
};

export function BillingPlans({
  plans,
  interval,
  onIntervalChange,
  onSelectPlan,
  isLoading = false,
}: BillingPlansProps) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-center gap-2">
        <button
          onClick={() => onIntervalChange('monthly')}
          className={cn('rounded-l-md border px-4 py-1.5 text-sm', {
            'bg-primary text-primary-foreground': interval === 'monthly',
            'text-muted-foreground': interval !== 'monthly',
          })}
        >
          Monthly
        </button>
        <button
          onClick={() => onIntervalChange('yearly')}
          className={cn('rounded-r-md border px-4 py-1.5 text-sm', {
            'bg-primary text-primary-foreground': interval === 'yearly',
            'text-muted-foreground': interval !== 'yearly',
          })}
        >
          Yearly
          <Badge className="ml-2" variant="secondary">Save 20%</Badge>
        </button>
      </div>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {plans.map((plan) => (
          <Card
            key={plan.id}
            className={cn('relative flex flex-col', {
              'ring-2 ring-primary': plan.isPopular,
            })}
          >
            {plan.isPopular && (
              <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">Most popular</Badge>
            )}
            <CardHeader>
              <CardTitle>{plan.name}</CardTitle>
              <CardDescription>{plan.description}</CardDescription>
            </CardHeader>
            <CardContent className="flex-1">
              <p className="mb-4 text-3xl font-bold">
                ${interval === 'monthly' ? plan.price.monthly : plan.price.yearly}
                <span className="text-sm font-normal text-muted-foreground">/mo</span>
              </p>
              <ul className="flex flex-col gap-2">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-center gap-2 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                    {feature}
                  </li>
                ))}
              </ul>
            </CardContent>
            <CardFooter>
              <Button
                className="w-full"
                variant={plan.isCurrent ? 'outline' : 'default'}
                disabled={plan.isCurrent || isLoading}
                onClick={() => onSelectPlan(plan.id)}
              >
                {plan.isCurrent ? 'Current plan' : 'Upgrade'}
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  );
}



declare const useState11: <T>(v: T) => [T, (v: T) => void];
declare const AnimatePresence2: React.FC<{ mode?: string; children?: React.ReactNode }>;
declare const MotionCard2: React.FC<{ key?: string; initial?: unknown; animate?: unknown; exit?: unknown; children?: React.ReactNode }>;
declare const CardContent2: React.FC<{ className?: string; children?: React.ReactNode }>;
declare const CardTitle2: React.FC<{ children?: React.ReactNode }>;
declare const IndividualPersonalLayoutCheckoutButton2: React.FC<{ priceId: string; children?: React.ReactNode }>;
declare const INTERNAL_CLAIM_ID2: { INDIVIDUAL: string };
declare const Trans5: React.FC<{ children?: React.ReactNode }>;
declare const React: { FC: unknown; ReactNode: unknown };

type BillingPrice2 = {
  id: string;
  friendlyPrice: string;
  claim: string;
  memberCount: number;
  product: {
    name: string;
    description: string;
    features?: Array<{ name: string }> | null;
  };
};

export const BillingPlansGrid2 = ({
  pricesToDisplay,
  interval,
  isMounted,
  isPersonalLayoutMode,
}: {
  pricesToDisplay: BillingPrice2[];
  interval: 'monthlyPrice' | 'yearlyPrice';
  isMounted: boolean;
  isPersonalLayoutMode: boolean;
}) => {
  return (
    <div className="mt-8 grid gap-8 lg:grid-cols-2 2xl:grid-cols-3">
      <AnimatePresence2 mode="wait">
        {pricesToDisplay.map((price) => (
          <MotionCard2
            key={price.id}
            initial={{ opacity: isMounted ? 0 : 1, y: isMounted ? 20 : 0 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.3 } }}
            exit={{ opacity: 0, transition: { duration: 0.3 } }}
          >
            <CardContent2 className="flex h-full flex-col p-6">
              <CardTitle2>{price.product.name}</CardTitle2>

              <div className="mt-2 font-medium text-lg text-muted-foreground">
                {price.friendlyPrice + ' '}
                <span className="text-xs">
                  {interval === 'monthlyPrice' ? <Trans5>per month</Trans5> : <Trans5>per year</Trans5>}
                </span>
              </div>

              <div className="mt-1.5 text-muted-foreground text-sm">{price.product.description}</div>

              {price.product.features && price.product.features.length > 0 && (
                <div className="mt-4 text-muted-foreground">
                  <div className="font-medium text-sm">
                    <Trans5>Includes:</Trans5>
                  </div>

                  <ul className="mt-1 divide-y text-sm">
                    {price.product.features.map((feature, index) => (
                      <li key={index} className="py-2">
                        {feature.name}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex-1" />

              {isPersonalLayoutMode && price.claim === INTERNAL_CLAIM_ID2.INDIVIDUAL ? (
                <IndividualPersonalLayoutCheckoutButton2 priceId={price.id}>
                  <Trans5>Subscribe</Trans5>
                </IndividualPersonalLayoutCheckoutButton2>
              ) : (
                <BillingDialog2
                  priceId={price.id}
                  planName={price.product.name}
                  memberCount={price.memberCount}
                  claim={price.claim}
                />
              )}
            </CardContent2>
          </MotionCard2>
        ))}
      </AnimatePresence2>
    </div>
  );
};

const BillingDialog2 = ({
  priceId,
  planName,
  claim,
}: {
  priceId: string;
  planName: string;
  memberCount: number;
  claim: string;
}) => {
  const [isOpen, setIsOpen] = useState11(false);

  return (
    <button
      type="button"
      className="mt-4 w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
      onClick={() => setIsOpen(true)}
    >
      Subscribe to {planName}
    </button>
  );
};



// [unknown-catch-variable] catch(_err) — underscore prefix signals intentional discard; never referenced
declare function initiatePlanUpgrade(opts: { orgId: string; planId: string }): Promise<{ checkoutUrl: string }>;
declare const orgId: string;
declare const billingToast: (opts: { title: string; description: string; variant?: string }) => void;

async function handlePlanUpgradeClick(planId: string): Promise<void> {
  try {
    const { checkoutUrl } = await initiatePlanUpgrade({ orgId, planId });
    window.location.href = checkoutUrl;
  } catch (_err) {
    billingToast({
      title: 'Upgrade unavailable',
      description: 'We could not process your upgrade request. Please try again later.',
      variant: 'destructive',
    });
  }
}
