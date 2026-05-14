
// Idiomatic Remix/Web-API HTTP error throwing — 'Not Found' is the HTTP reason phrase, not a domain magic string.
declare function getSigningSessionByToken(token: string): Promise<{ id: number } | null>;

export async function signingLoader({ params }: { params: { token?: string } }) {
  const { token } = params;

  if (!token) {
    throw new Response('Not Found', { status: 404 });
  }

  const session = await getSigningSessionByToken(token);

  if (!session) {
    throw new Response('Not Found', { status: 404 });
  }

  return { session };
}


declare const useLoaderData: () => { recipient: { name: string; email: string }; document: { title: string; status: string }; fields: Array<{ id: string; type: string; page: number; required: boolean }> };
declare const useNavigate: () => (path: string) => void;
declare const useToast: () => { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare const Button: (props: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; className?: string; variant?: string }) => JSX.Element;
declare const FieldRenderer: (props: { field: { id: string; type: string; page: number; required: boolean }; value: string; onChange: (v: string) => void }) => JSX.Element;
declare const DocumentPageViewer: (props: { pageNumber: number; fields: Array<{ id: string; type: string; page: number; required: boolean }> }) => JSX.Element;
declare const submitSignedFields: (token: string, fieldValues: Record<string, string>) => Promise<void>;
declare const useParams: () => { token?: string };

export default function RecipientSigningPage() {
  const { recipient, document, fields } = useLoaderData();
  const { token } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [fieldValues, setFieldValues] = React.useState<Record<string, string>>({});
  const [currentPage, setCurrentPage] = React.useState(1);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const totalPages = Math.max(...fields.map((f) => f.page), 1);
  const requiredFields = fields.filter((f) => f.required);
  const allRequiredFilled = requiredFields.every((f) => fieldValues[f.id]);

  const handleFieldChange = (fieldId: string, value: string) => {
    setFieldValues((prev) => ({ ...prev, [fieldId]: value }));
  };

  const handleSubmit = async () => {
    if (!allRequiredFilled) {
      toast({ title: 'Complete all required fields', variant: 'destructive' });
      return;
    }
    if (!token) return;
    setIsSubmitting(true);
    try {
      await submitSignedFields(token, fieldValues);
      navigate('/sign/complete');
    } catch {
      toast({
        title: 'Submission failed',
        description: 'Could not submit your signatures. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (document.status === 'completed') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Document already completed</h1>
          <p className="mt-2 text-muted-foreground">This document has already been signed.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b px-6 py-4">
        <h1 className="text-lg font-semibold">{document.title}</h1>
        <p className="text-sm text-muted-foreground">
          Signing as {recipient.name} ({recipient.email})
        </p>
      </header>
      <div className="flex flex-1 flex-col gap-4 p-6 lg:flex-row">
        <div className="flex-1">
          <DocumentPageViewer pageNumber={currentPage} fields={fields} />
          <div className="mt-3 flex items-center justify-between">
            <Button
              variant="outline"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">Page {currentPage} of {totalPages}</span>
            <Button
              variant="outline"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              Next
            </Button>
          </div>
        </div>
        <div className="flex w-full flex-col gap-4 lg:w-72">
          <h2 className="text-sm font-medium">Fields to complete</h2>
          {fields
            .filter((f) => f.page === currentPage)
            .map((field) => (
              <FieldRenderer
                key={field.id}
                field={field}
                value={fieldValues[field.id] ?? ''}
                onChange={(v) => handleFieldChange(field.id, v)}
              />
            ))}
          <Button
            className="mt-auto w-full"
            onClick={handleSubmit}
            disabled={isSubmitting || !allRequiredFilled}
          >
            {isSubmitting ? 'Submitting...' : 'Submit signature'}
          </Button>
        </div>
      </div>
    </div>
  );
}
