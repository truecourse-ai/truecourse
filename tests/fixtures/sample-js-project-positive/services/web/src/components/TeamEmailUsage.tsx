
declare const useQuery: (opts: any) => { data?: any; isLoading: boolean };
declare const Skeleton: any;
declare const Progress: any;
declare const Badge: any;
declare const format: (date: Date, fmt: string) => string;
declare const AlertTriangle: any;
declare const cn: (...args: any[]) => string;

type TeamEmailUsageData = {
  teamId: string;
  teamName: string;
  emailAddress: string;
  monthlyLimit: number;
  usedThisMonth: number;
  resetDate: string;
  history: Array<{ month: string; sent: number; bounced: number }>;
};

type TeamEmailUsageProps = {
  teamId: string;
};

export function TeamEmailUsage({ teamId }: TeamEmailUsageProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['team-email-usage', teamId],
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
    );
  }

  if (!data) return null;

  const usage = data as TeamEmailUsageData;
  const usagePercent = Math.round((usage.usedThisMonth / usage.monthlyLimit) * 100);
  const isNearLimit = usagePercent >= 80;
  const isAtLimit = usagePercent >= 100;

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-medium">Monthly usage</p>
          <span className="text-sm tabular-nums">
            {usage.usedThisMonth.toLocaleString()} / {usage.monthlyLimit.toLocaleString()}
          </span>
        </div>

        <Progress
          value={Math.min(usagePercent, 100)}
          className={cn(
            'h-2',
            isAtLimit && '[&>div]:bg-destructive',
            isNearLimit && !isAtLimit && '[&>div]:bg-amber-500',
          )}
        />

        {isNearLimit && (
          <div className="mt-2 flex items-center gap-1.5 text-sm">
            <AlertTriangle
              className={cn(
                'h-4 w-4',
                isAtLimit ? 'text-destructive' : 'text-amber-500',
              )}
            />
            <span className={cn(isAtLimit ? 'text-destructive' : 'text-amber-600')}>
              {isAtLimit
                ? 'Monthly limit reached'
                : `${100 - usagePercent}% remaining — limit resets ${format(new Date(usage.resetDate), 'MMM d')}`}
            </span>
          </div>
        )}
      </div>

      <div>
        <p className="mb-3 text-sm font-medium">Recent months</p>
        <div className="space-y-2">
          {usage.history.map((entry) => {
            const entryPercent = Math.round((entry.sent / usage.monthlyLimit) * 100);
            return (
              <div key={entry.month} className="flex items-center gap-3">
                <span className="w-24 text-xs text-muted-foreground">{entry.month}</span>
                <Progress value={entryPercent} className="h-1.5 flex-1" />
                <span className="w-16 text-right text-xs tabular-nums">
                  {entry.sent.toLocaleString()}
                </span>
                {entry.bounced > 0 && (
                  <Badge variant="destructive" className="text-xs">
                    {entry.bounced} bounced
                  </Badge>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
