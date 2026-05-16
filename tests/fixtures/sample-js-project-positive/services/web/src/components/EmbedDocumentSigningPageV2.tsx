
declare function useState<T>(init: T): [T, (v: T) => void];
declare function useEffect(fn: () => void | (() => void), deps?: any[]): void;
declare const useParams: () => Record<string, string>;
declare const useQuery: (opts: any) => { data?: any; isLoading: boolean; isError: boolean };
declare const EnvelopeSignerPageRenderer: any;
declare const Skeleton: any;
declare const AlertCircle: any;
declare const CheckCircle: any;

export function EmbedDocumentSigningPageV2() {
  const { token } = useParams();
  const [completed, setCompleted] = useState(false);

  const { data: session, isLoading, isError } = useQuery({
    queryKey: ['embed-signing-session', token],
    enabled: !!token,
  });

  useEffect(() => {
    if (completed && window.parent) {
      window.parent.postMessage(
        { action: 'signing-complete', data: { token } },
        '*',
      );
    }
  }, [completed, token]);

  if (isLoading) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-32" />
      </div>
    );
  }

  if (isError || !session) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4">
        <AlertCircle className="h-12 w-12 text-destructive" />
        <p className="text-sm text-muted-foreground">
          This signing link is invalid or has expired.
        </p>
      </div>
    );
  }

  if (completed) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4">
        <CheckCircle className="h-16 w-16 text-green-500" />
        <h2 className="text-xl font-semibold">Document Signed</h2>
        <p className="text-sm text-muted-foreground">
          You have successfully signed "{session.documentTitle}".
        </p>
      </div>
    );
  }

  return (
    <div className="h-screen">
      <EnvelopeSignerPageRenderer
        token={token}
        onCompleted={() => setCompleted(true)}
      />
    </div>
  );
}


// --- timing-attack-comparison FP: array length check on configuration, not a secret ---
// annotationTypes.length === 0 derives whether a mode is enabled; this is a config flag, not a secret.
const enum AnnotationInputMode { DRAW = 'DRAW', TYPE = 'TYPE', UPLOAD = 'UPLOAD' }

interface SigningPageConfig {
  annotationTypes?: AnnotationInputMode[];
}

function resolveInputModeSettings(config: SigningPageConfig) {
  const annotationTypes = config.annotationTypes ?? [];

  return {
    drawSignatureEnabled:
      annotationTypes.length === 0 || annotationTypes.includes(AnnotationInputMode.DRAW),
    typedSignatureEnabled:
      annotationTypes.length === 0 || annotationTypes.includes(AnnotationInputMode.TYPE),
    uploadSignatureEnabled:
      annotationTypes.length === 0 || annotationTypes.includes(AnnotationInputMode.UPLOAD),
  };
}



// FP: signatureTypes.length === 0 derives config flag — array length check, not secret comparison
const enum DrawMode { DRAW = 'DRAW', TYPE = 'TYPE', UPLOAD = 'UPLOAD' }

interface EmbedSigningConfig {
  signatureTypes?: DrawMode[];
}

function resolveEmbedSigningModes(config: EmbedSigningConfig) {
  const signatureTypes = config.signatureTypes ?? [];

  return {
    drawEnabled: signatureTypes.length === 0 || signatureTypes.includes(DrawMode.DRAW),
    typeEnabled: signatureTypes.length === 0 || signatureTypes.includes(DrawMode.TYPE),
    uploadEnabled: signatureTypes.length === 0 || signatureTypes.includes(DrawMode.UPLOAD),
  };
}

