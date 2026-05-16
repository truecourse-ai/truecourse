
declare const cn: (...args: any[]) => string;
declare const Check: any;

type StepStatus = 'completed' | 'current' | 'upcoming';

type Step = {
  id: string;
  label: string;
  description?: string;
};

type StepperProps = {
  steps: Step[];
  currentStepId: string;
  orientation?: 'horizontal' | 'vertical';
  onStepClick?: (stepId: string) => void;
  className?: string;
};

function getStepStatus(stepIndex: number, currentIndex: number): StepStatus {
  if (stepIndex < currentIndex) return 'completed';
  if (stepIndex === currentIndex) return 'current';
  return 'upcoming';
}

export function Stepper({
  steps,
  currentStepId,
  orientation = 'horizontal',
  onStepClick,
  className,
}: StepperProps) {
  const currentIndex = steps.findIndex((s) => s.id === currentStepId);

  const isVertical = orientation === 'vertical';

  return (
    <nav
      aria-label="Progress"
      className={cn(
        isVertical ? 'flex flex-col gap-0' : 'flex items-center gap-0',
        className,
      )}
    >
      {steps.map((step, index) => {
        const status = getStepStatus(index, currentIndex);
        const isLast = index === steps.length - 1;
        const isClickable = onStepClick && status === 'completed';

        return (
          <div
            key={step.id}
            className={cn(
              isVertical ? 'flex flex-col' : 'flex items-center',
              'flex-1',
            )}
          >
            <div
              className={cn(
                isVertical ? 'flex items-start gap-3' : 'flex flex-col items-center gap-1',
              )}
            >
              <button
                type="button"
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold transition-colors',
                  status === 'completed' && 'border-primary bg-primary text-primary-foreground',
                  status === 'current' && 'border-primary bg-background text-primary',
                  status === 'upcoming' && 'border-muted-foreground/30 bg-background text-muted-foreground',
                  isClickable && 'cursor-pointer hover:opacity-80',
                  !isClickable && 'cursor-default',
                )}
                onClick={() => isClickable && onStepClick?.(step.id)}
                aria-current={status === 'current' ? 'step' : undefined}
              >
                {status === 'completed' ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <span>{index + 1}</span>
                )}
              </button>

              <div className={cn(isVertical ? 'min-w-0 py-1' : 'text-center')}>
                <p
                  className={cn(
                    'text-sm font-medium',
                    status === 'upcoming' && 'text-muted-foreground',
                  )}
                >
                  {step.label}
                </p>

                {step.description && (
                  <p className="mt-0.5 text-xs text-muted-foreground">{step.description}</p>
                )}
              </div>
            </div>

            {!isLast && (
              <div
                className={cn(
                  isVertical
                    ? 'ml-4 flex-1 border-l-2 py-1'
                    : 'flex-1 border-t-2 translate-y-[-16px]',
                  index < currentIndex ? 'border-primary' : 'border-muted-foreground/30',
                )}
              />
            )}
          </div>
        );
      })}
    </nav>
  );
}
