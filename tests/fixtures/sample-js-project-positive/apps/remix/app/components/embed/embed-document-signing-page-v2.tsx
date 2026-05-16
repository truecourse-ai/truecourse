declare const useParams: () => { token?: string };
declare const useNavigate: () => (path: string) => void;
declare const useToast: () => { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare const SigningCanvas: (props: { onSigned: (dataUrl: string) => void; width: number; height: number }) => JSX.Element;
declare const DocumentPreview: (props: { documentUrl: string; pageNumber: number; totalPages: number; onPageChange: (page: number) => void }) => JSX.Element;
declare const Button: (props: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; variant?: string; className?: string }) => JSX.Element;
declare const fetchSigningDocument: (token: string) => Promise<{ documentUrl: string; totalPages: number; recipientName: string }>;
declare const submitSignedDocument: (token: string, signature: string) => Promise<void>;

export function EmbedDocumentSigningPageV2() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [document, setDocument] = React.useState<{ documentUrl: string; totalPages: number; recipientName: string } | null>(null);
  const [currentPage, setCurrentPage] = React.useState(1);
  const [signature, setSignature] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    if (!token) return;
    fetchSigningDocument(token)
      .then(setDocument)
      .catch(() => toast({ title: 'Failed to load document', variant: 'destructive' }))
      .finally(() => setIsLoading(false));
  }, [token]);

  const handleSubmit = async () => {
    if (!token || !signature) {
      toast({ title: 'Please sign the document first', variant: 'destructive' });
      return;
    }
    setIsSubmitting(true);
    try {
      await submitSignedDocument(token, signature);
      navigate('/signed/complete');
    } catch {
      toast({ title: 'Submission failed', description: 'Please try again.', variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="text-sm text-muted-foreground">Loading document...</span>
      </div>
    );
  }

  if (!document) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-destructive">Document could not be loaded.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b px-6 py-4">
        <h1 className="text-lg font-semibold">Sign document</h1>
        <p className="text-sm text-muted-foreground">Signing as {document.recipientName}</p>
      </header>
      <main className="flex flex-1 flex-col gap-6 p-6 lg:flex-row">
        <div className="flex-1">
          <DocumentPreview
            documentUrl={document.documentUrl}
            pageNumber={currentPage}
            totalPages={document.totalPages}
            onPageChange={setCurrentPage}
          />
        </div>
        <div className="flex w-full flex-col gap-4 lg:w-80">
          <div className="rounded-md border p-4">
            <p className="mb-2 text-sm font-medium">Your signature</p>
            <SigningCanvas onSigned={setSignature} width={280} height={120} />
            {signature && (
              <p className="mt-2 text-xs text-green-600">Signature captured</p>
            )}
          </div>
          <Button
            className="w-full"
            onClick={handleSubmit}
            disabled={isSubmitting || !signature}
          >
            {isSubmitting ? 'Submitting...' : 'Submit signed document'}
          </Button>
        </div>
      </main>
    </div>
  );
}
