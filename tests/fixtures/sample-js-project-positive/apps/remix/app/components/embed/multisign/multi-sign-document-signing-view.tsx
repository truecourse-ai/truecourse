declare const useSession: () => { user: { id: string; name: string; email: string } | null };
declare const useToast: () => { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare const Button: (props: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; variant?: string; className?: string }) => JSX.Element;
declare const ScrollArea: (props: { children: React.ReactNode; className?: string }) => JSX.Element;
declare const Separator: () => JSX.Element;
declare const SignatureFieldWidget: (props: { fieldId: string; recipientId: string; onSigned: (sig: string) => void; readOnly?: boolean }) => JSX.Element;
declare const submitMultiSignDocument: (opts: { sessionId: string; signatures: Record<string, string> }) => Promise<void>;

type MultiSignField = {
  id: string;
  type: string;
  recipientId: string;
  label?: string;
  page: number;
  required: boolean;
};

type MultiSignDocumentSigningViewProps = {
  sessionId: string;
  documentTitle: string;
  fields: MultiSignField[];
  currentRecipientId: string;
  onComplete: () => void;
};

export function MultiSignDocumentSigningView({
  sessionId,
  documentTitle,
  fields,
  currentRecipientId,
  onComplete,
}: MultiSignDocumentSigningViewProps) {
  const { user } = useSession();
  const { toast } = useToast();
  const [signatures, setSignatures] = React.useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const myFields = fields.filter((f) => f.recipientId === currentRecipientId);
  const requiredFields = myFields.filter((f) => f.required);
  const allRequiredSigned = requiredFields.every((f) => signatures[f.id]);

  const handleSigned = (fieldId: string, sig: string) => {
    setSignatures((prev) => ({ ...prev, [fieldId]: sig }));
  };

  const handleSubmit = async () => {
    if (!allRequiredSigned) {
      toast({
        title: 'Please complete all required fields',
        variant: 'destructive',
      });
      return;
    }
    setIsSubmitting(true);
    try {
      await submitMultiSignDocument({ sessionId, signatures });
      onComplete();
    } catch {
      toast({
        title: 'Submission failed',
        description: 'Unable to submit your signatures. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold">{documentTitle}</h2>
        {user && (
          <p className="text-sm text-muted-foreground">Signing as {user.name} ({user.email})</p>
        )}
      </div>
      <Separator />
      <ScrollArea className="max-h-[60vh]">
        <div className="flex flex-col gap-4 pr-4">
          {myFields.length === 0 ? (
            <p className="text-sm text-muted-foreground">No fields to sign.</p>
          ) : (
            myFields.map((field) => (
              <div key={field.id} className="rounded-md border p-4">
                <p className="mb-2 text-sm font-medium">
                  {field.label ?? field.type}
                  {field.required && <span className="ml-1 text-destructive">*</span>}
                </p>
                <SignatureFieldWidget
                  fieldId={field.id}
                  recipientId={currentRecipientId}
                  onSigned={(sig) => handleSigned(field.id, sig)}
                />
              </div>
            ))
          )}
        </div>
      </ScrollArea>
      <div className="flex justify-end">
        <Button onClick={handleSubmit} disabled={isSubmitting || !allRequiredSigned} className="w-full sm:w-auto">
          {isSubmitting ? 'Submitting...' : 'Submit signatures'}
        </Button>
      </div>
    </div>
  );
}
