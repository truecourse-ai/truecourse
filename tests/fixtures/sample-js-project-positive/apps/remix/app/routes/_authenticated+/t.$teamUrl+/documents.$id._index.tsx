declare const useLoaderData: () => { document: { id: string; title: string; status: string; createdAt: string; recipients: Array<{ id: string; name: string; email: string; status: string }> } };
declare const useNavigate: () => (path: string) => void;
declare const Button: (props: { children: React.ReactNode; onClick?: () => void; variant?: string; size?: string; disabled?: boolean }) => JSX.Element;
declare const Badge: (props: { children: React.ReactNode; variant?: string }) => JSX.Element;
declare const Card: (props: { children: React.ReactNode; className?: string }) => JSX.Element;
declare const CardContent: (props: { children: React.ReactNode; className?: string }) => JSX.Element;
declare const CardHeader: (props: { children: React.ReactNode }) => JSX.Element;
declare const CardTitle: (props: { children: React.ReactNode }) => JSX.Element;
declare const Separator: () => JSX.Element;
declare const formatDate: (d: string) => string;

export default function DocumentDetailPage() {
  const { document } = useLoaderData();
  const navigate = useNavigate();

  const pendingRecipients = document.recipients.filter((r) => r.status === 'pending');
  const completedRecipients = document.recipients.filter((r) => r.status !== 'pending');

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{document.title}</h1>
          <p className="text-sm text-muted-foreground">Created {formatDate(document.createdAt)}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={document.status === 'completed' ? 'default' : 'secondary'}>
            {document.status}
          </Badge>
          <Button variant="outline" size="sm" onClick={() => navigate(-1 as unknown as string)}>
            Back
          </Button>
        </div>
      </div>
      <Separator />
      <Card>
        <CardHeader>
          <CardTitle>Recipients</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {document.recipients.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recipients.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {pendingRecipients.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">Awaiting</p>
                  {pendingRecipients.map((r) => (
                    <div key={r.id} className="flex items-center justify-between py-1">
                      <div>
                        <p className="text-sm font-medium">{r.name}</p>
                        <p className="text-xs text-muted-foreground">{r.email}</p>
                      </div>
                      <Badge variant="secondary">pending</Badge>
                    </div>
                  ))}
                </div>
              )}
              {completedRecipients.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">Completed</p>
                  {completedRecipients.map((r) => (
                    <div key={r.id} className="flex items-center justify-between py-1">
                      <div>
                        <p className="text-sm font-medium">{r.name}</p>
                        <p className="text-xs text-muted-foreground">{r.email}</p>
                      </div>
                      <Badge>{r.status}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
