declare const useSession: () => { user: { id: string; email: string; name: string } | null };
declare const useToast: () => { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare const Button: (props: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; variant?: string; className?: string }) => JSX.Element;
declare const Card: (props: { children: React.ReactNode; className?: string }) => JSX.Element;
declare const CardContent: (props: { children: React.ReactNode; className?: string }) => JSX.Element;
declare const CardHeader: (props: { children: React.ReactNode; className?: string }) => JSX.Element;
declare const CardTitle: (props: { children: React.ReactNode }) => JSX.Element;
declare const Separator: () => JSX.Element;
declare const submitDirectTemplateForm: (opts: { templateId: string; recipientName: string; recipientEmail: string }) => Promise<{ redirectUrl: string }>;

type DirectTemplateSignPageProps = {
  templateId: string;
  templateName: string;
  senderName: string;
  expiresAt?: Date;
};

export function DirectTemplateSignPage({
  templateId,
  templateName,
  senderName,
  expiresAt,
}: DirectTemplateSignPageProps) {
  const { user } = useSession();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [recipientName, setRecipientName] = React.useState(user?.name ?? '');
  const [recipientEmail, setRecipientEmail] = React.useState(user?.email ?? '');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recipientName || !recipientEmail) {
      toast({ title: 'Missing fields', description: 'Please fill in your name and email.', variant: 'destructive' });
      return;
    }
    setIsSubmitting(true);
    try {
      const { redirectUrl } = await submitDirectTemplateForm({ templateId, recipientName, recipientEmail });
      window.location.href = redirectUrl;
    } catch {
      toast({ title: 'Error', description: 'Could not start signing. Please try again.', variant: 'destructive' });
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{templateName}</CardTitle>
          <p className="text-sm text-muted-foreground">Requested by {senderName}</p>
          {expiresAt && (
            <p className="text-xs text-muted-foreground">
              Expires: {expiresAt.toLocaleDateString()}
            </p>
          )}
        </CardHeader>
        <Separator />
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="name" className="text-sm font-medium">Your Name</label>
              <input
                id="name"
                type="text"
                className="rounded-md border px-3 py-2 text-sm"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="email" className="text-sm font-medium">Your Email</label>
              <input
                id="email"
                type="email"
                className="rounded-md border px-3 py-2 text-sm"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={isSubmitting} className="w-full">
              {isSubmitting ? 'Starting...' : 'Start Signing'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}



// [unknown-catch-variable] catch(err) — generic toast shown then re-thrown; no property access on err
declare function completeDirectTemplateFlow(opts: { templateId: string; fields: unknown[] }): Promise<void>;
declare const templateToast: (opts: { title: string; description: string; variant?: string }) => void;
declare const templateId: string;
declare const collectedFields: unknown[];

async function handleDirectTemplateSubmit(): Promise<void> {
  try {
    await completeDirectTemplateFlow({ templateId, fields: collectedFields });
  } catch (err) {
    templateToast({
      title: 'Submission failed',
      description: 'An error occurred. Please try again.',
      variant: 'destructive',
    });
    throw err;
  }
}
