declare const Sheet: (props: { open?: boolean; onOpenChange?: (open: boolean) => void; children: React.ReactNode }) => JSX.Element;
declare const SheetContent: (props: { children: React.ReactNode; side?: string; className?: string }) => JSX.Element;
declare const SheetHeader: (props: { children: React.ReactNode }) => JSX.Element;
declare const SheetTitle: (props: { children: React.ReactNode }) => JSX.Element;
declare const SheetDescription: (props: { children: React.ReactNode }) => JSX.Element;
declare const Badge: (props: { children: React.ReactNode; variant?: string }) => JSX.Element;
declare const ScrollArea: (props: { children: React.ReactNode; className?: string }) => JSX.Element;
declare const formatDateTime: (d: Date) => string;
declare const cn: (...args: unknown[]) => string;

type WebhookDeliveryLog = {
  id: string;
  eventType: string;
  status: 'success' | 'failed' | 'pending';
  responseCode?: number;
  createdAt: Date;
  payload: string;
  responseBody?: string;
  errorMessage?: string;
};

type WebhookLogsSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  webhookId: string;
  logs: WebhookDeliveryLog[];
  isLoading?: boolean;
};

export function WebhookLogsSheet({
  open,
  onOpenChange,
  webhookId: _webhookId,
  logs,
  isLoading = false,
}: WebhookLogsSheetProps) {
  const [expandedId, setExpandedId] = React.useState<string | null>(null);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-2xl">
        <SheetHeader>
          <SheetTitle>Webhook delivery logs</SheetTitle>
          <SheetDescription>Recent delivery attempts for this webhook endpoint.</SheetDescription>
        </SheetHeader>
        <ScrollArea className="mt-6 h-[calc(100vh-8rem)]">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <span className="text-sm text-muted-foreground">Loading logs...</span>
            </div>
          ) : logs.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <span className="text-sm text-muted-foreground">No delivery logs yet.</span>
            </div>
          ) : (
            <div className="flex flex-col gap-3 pr-4">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className="rounded-md border p-4"
                  onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={log.status === 'success' ? 'default' : log.status === 'failed' ? 'destructive' : 'secondary'}
                      >
                        {log.status}
                      </Badge>
                      <span className="text-sm font-medium">{log.eventType}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{formatDateTime(log.createdAt)}</span>
                  </div>
                  {log.responseCode && (
                    <p className="mt-1 text-xs text-muted-foreground">HTTP {log.responseCode}</p>
                  )}
                  {expandedId === log.id && (
                    <div className="mt-3 flex flex-col gap-2">
                      <div>
                        <p className="mb-1 text-xs font-medium">Payload</p>
                        <pre className={cn('rounded bg-muted p-2 text-xs overflow-x-auto')}>{log.payload}</pre>
                      </div>
                      {log.responseBody && (
                        <div>
                          <p className="mb-1 text-xs font-medium">Response</p>
                          <pre className="rounded bg-muted p-2 text-xs overflow-x-auto">{log.responseBody}</pre>
                        </div>
                      )}
                      {log.errorMessage && (
                        <p className="text-xs text-destructive">{log.errorMessage}</p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
