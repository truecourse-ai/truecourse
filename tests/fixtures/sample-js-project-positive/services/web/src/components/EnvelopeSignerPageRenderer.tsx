
declare function useState<T>(init: T): [T, (v: T) => void];
declare function useCallback<T extends (...args: any[]) => any>(fn: T, deps: any[]): T;
declare const useQuery: (opts: any) => { data?: any; isLoading: boolean; isError: boolean };
declare const useMutation: (opts: any) => { mutateAsync: (...a: any[]) => Promise<any>; isPending: boolean };
declare const DocumentViewer: any;
declare const FieldOverlay: any;
declare const SigningToolbar: any;
declare const Skeleton: any;
declare const AlertCircle: any;
declare const Button: any;

type SignerField = {
  id: string;
  type: string;
  page: number;
  positionX: number;
  positionY: number;
  width: number;
  height: number;
  required: boolean;
  signed: boolean;
};

type EnvelopeSignerPageRendererProps = {
  token: string;
  onCompleted: () => void;
};

export const EnvelopeSignerPageRenderer = ({
  token,
  onCompleted,
}: EnvelopeSignerPageRendererProps) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [signedFields, setSignedFields] = useState<Set<string>>(new Set());
  const [showPendingAlert, setShowPendingAlert] = useState(false);

  const { data: envelope, isLoading, isError } = useQuery({
    queryKey: ['signer-envelope', token],
    enabled: !!token,
  });

  const { mutateAsync: signField } = useMutation({});
  const { mutateAsync: submitSigning, isPending: isSubmitting } = useMutation({});

  const fields: SignerField[] = envelope?.fields ?? [];
  const myFields = fields.filter((f) => !f.signed);
  const pendingFields = myFields.filter((f) => !signedFields.has(f.id));

  const handleFieldSign = useCallback(
    async (fieldId: string, value: string) => {
      await signField({ token, fieldId, value });
      setSignedFields((prev) => new Set(prev).add(fieldId));
    },
    [token, signField],
  );

  const handleSubmit = useCallback(async () => {
    if (pendingFields.some((f) => f.required)) {
      setShowPendingAlert(true);
      return;
    }

    await submitSigning({ token });
    onCompleted();
  }, [pendingFields, token, submitSigning, onCompleted]);

  if (isLoading) {
    return (
      <div className="flex h-full flex-col gap-4 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="flex-1 rounded-lg" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <AlertCircle className="h-12 w-12 text-destructive" />
        <p className="text-sm text-muted-foreground">Unable to load signing session.</p>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col">
      <SigningToolbar
        totalFields={myFields.length}
        signedCount={signedFields.size}
        pendingCount={pendingFields.length}
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
      />

      <div className="relative flex-1 overflow-hidden">
        <DocumentViewer
          documentUrl={envelope?.documentUrl}
          totalPages={envelope?.totalPages ?? 1}
          currentPage={currentPage}
          onPageChange={setCurrentPage}
        >
          <FieldOverlay
            fields={fields}
            currentPage={currentPage}
            signedFields={signedFields}
            onSign={handleFieldSign}
          />
        </DocumentViewer>
      </div>

      {showPendingAlert && (
        <div className="absolute inset-x-0 bottom-20 mx-auto max-w-sm rounded-lg border border-destructive bg-destructive/10 p-4 shadow-lg">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
            <div>
              <p className="text-sm font-medium text-destructive">Required fields incomplete</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Please complete all required fields before submitting.
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto -mr-1 -mt-1 shrink-0"
              onClick={() => setShowPendingAlert(false)}
            >
              <span aria-hidden>×</span>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};


// --- argument-type-mismatch FP: render() called with JSX element tree wrapping a provider ---
// EmailRenderer.render(<I18nProvider i18n={i18n}>...) — renders React element tree, no type mismatch.
declare namespace ReactEmail {
  function render(element: JSX.Element, opts?: { pretty?: boolean }): Promise<string>;
}

type I18nConfig2 = { locale: string; messages: Record<string, string> };
type NotificationEmailProps = { subject: string; recipientName: string; tokenExpiry: string };

declare const I18nProvider2: (props: { i18n: I18nConfig2; children: JSX.Element }) => JSX.Element;
declare const SigningReminderEmail: (props: NotificationEmailProps) => JSX.Element;

export async function renderSigningReminderEmail(
  i18n: I18nConfig2,
  props: NotificationEmailProps,
): Promise<string> {
  return ReactEmail.render(
    <I18nProvider2 i18n={i18n}>
      <SigningReminderEmail {...props} />
    </I18nProvider2>,
    { pretty: false },
  );
}



// --- argument-type-mismatch FP: .filter() comparing status field to enum value ---
// recipients.filter((r) => r.signingStatus === SigningStatus.SIGNED) — valid enum comparison, no type mismatch.
enum SigningStatus2 { PENDING = 'PENDING', SIGNED = 'SIGNED', REJECTED = 'REJECTED' }

interface EnvelopeRecipient { id: string; email: string; signingStatus: SigningStatus2; role: string; }

export function getCompletedSigners(recipients: EnvelopeRecipient[]): EnvelopeRecipient[] {
  return recipients.filter(
    (r) => r.signingStatus === SigningStatus2.SIGNED,
  );
}



// FP shape: recipients.map() with prefill transform on nested fields — standard
// nested map operation; no type mismatch.
declare const envelopeSigningData: {
  recipients: Array<{
    id: number;
    name: string;
    email: string;
    fields: Array<{ id: string; type: string; value: string | null }>;
  }>;
};
declare const prefillFieldValues: Record<string, string>;

export function applyPrefillToEnvelopeRecipients() {
  return {
    ...envelopeSigningData,
    recipients: envelopeSigningData.recipients.map((recipient) => ({
      ...recipient,
      fields: recipient.fields.map((field) => ({
        ...field,
        value: prefillFieldValues[field.id] ?? field.value,
      })),
    })),
  };
}



// group.name() === 'field-group' && !activeFields.some() — Konva-style name check returns boolean, no type mismatch
declare const stage: { findOne: (selector: string) => { find: (sel: string) => Array<{ name: () => string; id: () => string; destroy: () => void }> } | null };
declare const activeFieldIds: Array<{ id: number }>;

export function cleanupStaleFieldGroups(): void {
  const layer = stage.findOne('Layer');
  if (!layer) return;

  layer.find('Group').forEach((group) => {
    if (
      group.name() === 'field-group' &&
      !activeFieldIds.some((field) => field.id.toString() === group.id())
    ) {
      group.destroy();
    }
  });
}

