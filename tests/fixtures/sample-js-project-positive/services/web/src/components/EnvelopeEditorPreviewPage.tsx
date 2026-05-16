
declare function useState<T>(init: T): [T, (v: T) => void];
declare function useEffect(fn: () => void | (() => void), deps?: any[]): void;
declare const useParams: () => Record<string, string>;
declare const useQuery: (opts: any) => { data?: any; isLoading: boolean; isError: boolean };
declare const Link: any;
declare const DocumentViewer: any;
declare const Button: any;
declare const Badge: any;
declare const Skeleton: any;
declare const AlertCircle: any;
declare const ArrowLeft: any;
declare const Edit2: any;
declare const Send: any;

export function EnvelopeEditorPreviewPage() {
  const { envelopeId } = useParams();
  const [currentPage, setCurrentPage] = useState(1);

  const { data: envelope, isLoading, isError } = useQuery({
    queryKey: ['envelope-preview', envelopeId],
    enabled: !!envelopeId,
  });

  useEffect(() => {
    setCurrentPage(1);
  }, [envelopeId]);

  if (isLoading) {
    return (
      <div className="flex h-full flex-col gap-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="flex-1 rounded-lg" />
      </div>
    );
  }

  if (isError || !envelope) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
        <AlertCircle className="h-12 w-12 text-destructive" />
        <p className="text-sm text-muted-foreground">Failed to load envelope preview.</p>
        <Button asChild variant="outline">
          <Link to="/envelopes">Back to Envelopes</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-4 border-b px-6 py-4">
        <Button asChild variant="ghost" size="icon">
          <Link to={`/envelopes/${envelopeId}/edit`}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>

        <div className="flex-1">
          <h1 className="text-lg font-semibold">{envelope.title}</h1>
          <div className="flex items-center gap-2">
            <Badge variant="outline">{envelope.status}</Badge>
            <span className="text-sm text-muted-foreground">
              {envelope.recipientCount} recipient{envelope.recipientCount !== 1 ? 's' : ''}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline">
            <Link to={`/envelopes/${envelopeId}/edit`}>
              <Edit2 className="mr-2 h-4 w-4" />
              Edit
            </Link>
          </Button>

          {envelope.status === 'DRAFT' && (
            <Button asChild>
              <Link to={`/envelopes/${envelopeId}/send`}>
                <Send className="mr-2 h-4 w-4" />
                Send
              </Link>
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        <DocumentViewer
          documentUrl={envelope.documentUrl}
          totalPages={envelope.totalPages}
          currentPage={currentPage}
          onPageChange={setCurrentPage}
        />
      </div>
    </div>
  );
}
