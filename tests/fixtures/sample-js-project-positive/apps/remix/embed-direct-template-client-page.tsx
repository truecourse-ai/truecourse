
declare function useState<T>(init: T): [T, (v: T) => void];
declare const useSearchParams: () => [URLSearchParams, (p: URLSearchParams) => void];
declare const useLoaderData: <T>() => T;
declare const z: any;
declare const EnvelopeSignerPageRenderer: any;
declare const Button: any;
declare const Input: any;
declare const Label: any;
declare const CheckCircle: any;
declare const AlertCircle: any;
declare const Loader2: any;
declare const validateFieldsInserted: (fields: any[]) => boolean;
declare const zEmail: () => any;

type EmbedDirectTemplateLoaderData = {
  templateId: string;
  documentTitle: string;
  recipientCount: number;
  pendingFields: any[];
};

export function EmbedDirectTemplateClientPage() {
  const { templateId, documentTitle, recipientCount, pendingFields } =
    useLoaderData<EmbedDirectTemplateLoaderData>();
  const [searchParams] = useSearchParams();

  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(true);
  const [showPendingFieldTooltip, setShowPendingFieldTooltip] = useState(false);
  const [isSigning, setIsSigning] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFieldSigned = () => {
    if (window.parent) {
      window.parent.postMessage({ action: 'field-signed', data: null }, '*');
    }

    setShowPendingFieldTooltip(false);
  };

  const onFieldUnsigned = () => {
    if (window.parent) {
      window.parent.postMessage({ action: 'field-unsigned', data: null }, '*');
    }

    setShowPendingFieldTooltip(false);
  };

  const onNextFieldClick = () => {
    validateFieldsInserted(pendingFields);
    setShowPendingFieldTooltip(true);
    setIsExpanded(false);
  };

  const onCompleteClick = async () => {
    try {
      const valid = validateFieldsInserted(pendingFields);

      if (!valid) {
        setShowPendingFieldTooltip(true);
        return;
      }

      const { success: isEmailValid } = zEmail().safeParse(email);

      if (!isEmailValid) {
        setEmailError('A valid email is required');
        setIsExpanded(true);
        return;
      }

      let directTemplateExternalId = searchParams?.get('externalId') || undefined;

      if (directTemplateExternalId) {
        const { success } = z.string().uuid().safeParse(directTemplateExternalId);

        if (!success) {
          directTemplateExternalId = undefined;
        }
      }

      setIsSigning(true);

      await new Promise<void>((resolve, reject) => {
        setTimeout(() => resolve(), 1000);
      });

      setIsCompleted(true);

      if (window.parent) {
        window.parent.postMessage({ action: 'signing-complete', data: { email } }, '*');
      }
    } catch (err) {
      setError('An error occurred while completing the document. Please try again.');
    } finally {
      setIsSigning(false);
    }
  };

  if (isCompleted) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <CheckCircle className="h-16 w-16 text-green-500" />
        <h2 className="text-xl font-semibold">Document Completed</h2>
        <p className="text-sm text-muted-foreground">
          You have successfully completed "{documentTitle}".
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      <div className="flex-1 overflow-hidden">
        <EnvelopeSignerPageRenderer
          templateId={templateId}
          pendingFields={pendingFields}
          showPendingFieldTooltip={showPendingFieldTooltip}
          onFieldSigned={onFieldSigned}
          onFieldUnsigned={onFieldUnsigned}
        />
      </div>

      <div className="border-t bg-background p-4">
        {error && (
          <div className="mb-3 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {isExpanded && (
          <div className="mb-4 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="signer-email">Your email address</Label>
              <Input
                id="signer-email"
                type="email"
                value={email}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  setEmail(e.target.value);
                  setEmailError(null);
                }}
                placeholder="you@example.com"
              />
              {emailError && (
                <p className="text-sm text-destructive">{emailError}</p>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center gap-3">
          {pendingFields.length > 0 && (
            <Button variant="outline" onClick={onNextFieldClick} className="flex-1">
              Next field ({pendingFields.length} remaining)
            </Button>
          )}

          <Button
            onClick={onCompleteClick}
            disabled={isSigning}
            className="flex-1"
          >
            {isSigning ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Completing…
              </>
            ) : (
              'Complete'
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
