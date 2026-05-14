
// FP: React component with hooks and JSX — line count inflated by framework structure
declare const useActivityLog: (opts: { resourceId: number; userId: number }) => { data: Array<{ id: string; action: string; actorName: string; createdAt: string; isError: boolean }>; isLoading: boolean };
declare const AnimateFade: React.FC<{ show: boolean; children: React.ReactNode }>;
declare function cn(...classes: (string | undefined | false)[]): string;
declare const CheckIcon: React.FC<{ className?: string }>;
declare const AlertIcon: React.FC<{ className?: string }>;
declare const Loader: React.FC<{ className?: string }>;
declare const MailOpenIcon: React.FC<{ className?: string }>;
declare const formatRelativeTime: (iso: string) => string;
declare const matchAction: <T>(action: string, patterns: Record<string, () => T>) => T;

export type ActivityFeedProps = {
  resourceId: number;
  userId: number;
};

export const ActivityFeed = ({ resourceId, userId }: ActivityFeedProps) => {
  const { data: entries, isLoading } = useActivityLog({ resourceId, userId });

  const items = React.useMemo(() => {
    if (!entries) return [];
    return entries.map((entry) => ({
      ...entry,
      label: matchAction(entry.action, {
        'VIEWED': () => 'viewed the document',
        'SIGNED': () => 'signed the document',
        'SENT': () => 'sent the document',
        'COMPLETED': () => 'completed signing',
        'REJECTED': () => 'rejected the document',
        default: () => entry.action.toLowerCase().replace(/_/g, ' '),
      }),
    }));
  }, [entries]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader className="text-muted-foreground h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="text-muted-foreground flex flex-col items-center justify-center py-8 text-sm">
        <MailOpenIcon className="mb-2 h-8 w-8 opacity-50" />
        <p>No activity yet</p>
      </div>
    );
  }

  return (
    <ul className="divide-y">
      {items.map((item) => (
        <li key={item.id} className="flex items-start gap-3 py-3">
          <AnimateFade show={true}>
            <span
              className={cn(
                'mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full',
                item.isError
                  ? 'bg-destructive/10 text-destructive'
                  : 'bg-primary/10 text-primary',
              )}
            >
              {item.isError ? (
                <AlertIcon className="h-3.5 w-3.5" />
              ) : (
                <CheckIcon className="h-3.5 w-3.5" />
              )}
            </span>
          </AnimateFade>

          <div className="min-w-0 flex-1">
            <p className="text-sm">
              <span className="font-medium">{item.actorName}</span>{' '}
              <span className="text-muted-foreground">{item.label}</span>
            </p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {formatRelativeTime(item.createdAt)}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
};
