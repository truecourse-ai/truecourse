
// FP shape: object literal with typed properties (object literal initialization)
declare type CreateEnvelopePayload = {
  title: string;
  type: string;
  externalId?: string;
  visibility: string;
  globalAccessAuth?: string[];
  globalActionAuth?: string[];
  folderId?: string;
  recipients: Array<{ email: string; name: string; role: string; fields: unknown[] }>;
  meta: { timezone?: string; language?: string };
};

const buildCreatePayload = (envelope: {
  title: string;
  type: string;
  externalId?: string;
  visibility: string;
  folderId?: string;
  documentMeta: { timezone?: string; language?: string };
}): CreateEnvelopePayload => {
  const payload: CreateEnvelopePayload = {
    title: envelope.title,
    type: envelope.type,
    externalId: envelope.externalId ?? undefined,
    visibility: envelope.visibility,
    folderId: envelope.folderId ?? undefined,
    recipients: [],
    meta: {
      timezone: envelope.documentMeta.timezone,
      language: envelope.documentMeta.language,
    },
  };
  return payload;
};



// --- too-many-lines shape: React TSX route component with hooks and JSX markup inflating line count ---
declare function useState<T>(init: T): [T, (v: T) => void];
declare function useMemo<T>(factory: () => T, deps: unknown[]): T;
declare function useLayoutEffect(effect: () => void, deps?: unknown[]): void;
declare function useToast(): { toast: (opts: { variant?: string; title: string; description: string }) => void };
declare function useLingui(): { t: (s: TemplateStringsArray, ...args: unknown[]) => string };
declare function useLoaderData<T>(): T;
declare const React: { createElement: (...args: unknown[]) => unknown };

declare type FormStatus = 'DRAFT' | 'SUBMITTED' | 'ACCEPTED' | 'REJECTED';
declare type RecipientRole = 'SIGNER' | 'VIEWER' | 'APPROVER';
declare type ReadStatus = 'NOT_OPENED' | 'OPENED';
declare type SigningStatus = 'NOT_SIGNED' | 'SIGNED';
declare type SendStatus = 'NOT_SENT' | 'SENT';

declare type TFormRecipient = {
  id: number;
  formId: string;
  email: string;
  name: string;
  role: RecipientRole;
  token: string;
  readStatus: ReadStatus;
  signingStatus: SigningStatus;
  sendStatus: SendStatus;
  signingOrder: number | null;
  rejectionReason: string | null;
};

declare type TEditorForm = {
  id: string;
  title: string;
  status: FormStatus;
  visibility: string;
  externalId: string | null;
  folderId: string | null;
  userId: number;
  teamId: number;
  recipients: TFormRecipient[];
  fields: Array<{
    id: number;
    recipientId: number;
    page: number;
    positionX: number;
    positionY: number;
    width: number;
    height: number;
    type: string;
    fieldMeta?: unknown;
  }>;
  formMeta: {
    id: string;
    timezone?: string;
    language?: string;
    subject?: string;
    message?: string;
    redirectUrl?: string;
  };
  attachments: unknown[];
};

declare type TCreateFormPayload = {
  title: string;
  visibility: string;
  externalId?: string;
  folderId?: string;
  recipients: Array<{
    email: string;
    name: string;
    role: RecipientRole;
    signingOrder?: number;
    fields: unknown[];
  }>;
  meta: {
    timezone?: string;
    language?: string;
    subject?: string;
    message?: string;
    redirectUrl?: string;
  };
  attachments: unknown[];
};

declare type TEmbedFormAuthoringOptions = {
  user: { id: number; name: string; email: string };
  features: Record<string, boolean>;
  folderId?: string;
  externalId?: string;
};

declare type TLoaderData = {
  token: string;
  tokenUserId: number;
  tokenTeamId: number;
  teamSettings: {
    defaultRecipients?: Array<{ email: string; name: string; role: RecipientRole }>;
    documentVisibility: string;
    brandingEnabled: boolean;
    brandingLogo?: string;
    timezone?: string;
    language?: string;
  };
};

declare function buildEmbedEditorOptions(
  features: Record<string, boolean>,
  embedded: unknown,
): unknown;

declare function extractDefaultFormMeta(
  settings: TLoaderData['teamSettings'],
): { timezone?: string; language?: string };

declare function createEmbeddingForm(formData: FormData): Promise<{ id: string }>;

declare const CheckCircleIcon: (props: { className: string }) => JSX.Element;
declare const Spinner: () => JSX.Element;
declare const FormEditorProvider: (props: {
  initialForm: TEditorForm;
  editorConfig: unknown;
  children: JSX.Element;
}) => JSX.Element;
declare const FormEditor: () => JSX.Element;

type EmbedFormCreatePageProps = {
  embedAuthoringOptions: TEmbedFormAuthoringOptions;
};

const EmbedFormCreatePage = ({ embedAuthoringOptions }: EmbedFormCreatePageProps): JSX.Element => {
  const { token, tokenUserId, tokenTeamId, teamSettings } = useLoaderData<TLoaderData>();

  const { t } = useLingui();
  const { toast } = useToast();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedForm, setSubmittedForm] = useState<{ id: string } | null>(null);

  const buildCreateFormRequest = (
    form: Omit<TEditorForm, 'id'>,
  ): { payload: TCreateFormPayload; files: File[] } => {
    const files: File[] = [];

    const recipients = form.recipients.map((recipient) => {
      const recipientFields = form.fields.filter((f) => f.recipientId === recipient.id);

      const fields = recipientFields.map((field) => ({
        page: field.page,
        positionX: Number(field.positionX),
        positionY: Number(field.positionY),
        width: Number(field.width),
        height: Number(field.height),
        type: field.type,
        fieldMeta: field.fieldMeta ?? undefined,
      }));

      return {
        email: recipient.email,
        name: recipient.name,
        role: recipient.role,
        signingOrder: recipient.signingOrder ?? undefined,
        fields,
      };
    });

    const payload: TCreateFormPayload = {
      title: form.title,
      visibility: form.visibility,
      externalId: form.externalId ?? undefined,
      folderId: form.folderId ?? undefined,
      recipients,
      attachments: form.attachments,
      meta: {
        timezone: form.formMeta.timezone ?? undefined,
        language: form.formMeta.language ?? undefined,
        subject: form.formMeta.subject ?? undefined,
        message: form.formMeta.message ?? undefined,
        redirectUrl: form.formMeta.redirectUrl ?? undefined,
      },
    };

    return { payload, files };
  };

  const handleSubmitForm = async (formWithoutId: Omit<TEditorForm, 'id'>) => {
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);

    try {
      const { payload, files } = buildCreateFormRequest(formWithoutId);

      const formData = new FormData();
      formData.append('payload', JSON.stringify(payload));

      for (const file of files) {
        formData.append('files', file);
      }

      const { id } = await createEmbeddingForm(formData);

      if (window.parent !== window) {
        window.parent.postMessage(
          {
            type: 'form-submitted',
            formId: id,
            externalId: formWithoutId.externalId,
          },
          '*',
        );
      }

      setSubmittedForm({ id });
    } catch (err) {
      console.error('Failed to submit form:', err);

      toast({
        variant: 'destructive',
        title: t`Error`,
        description: t`Failed to submit form. Please try again.`,
      });
    }

    setIsSubmitting(false);
  };

  const embedded = useMemo(
    () => ({
      presignToken: token,
      mode: 'create' as const,
      onSubmit: async (form: Omit<TEditorForm, 'id'>) => handleSubmitForm(form),
      customBrandingLogo: Boolean(teamSettings.brandingEnabled && teamSettings.brandingLogo),
      user: embedAuthoringOptions.user,
    }),
    [token],
  );

  const editorConfig = useMemo(() => {
    return buildEmbedEditorOptions(embedAuthoringOptions.features, embedded);
  }, [embedAuthoringOptions.features, embedded]);

  const initialForm = useMemo((): TEditorForm => {
    const defaultMeta = extractDefaultFormMeta(teamSettings);

    const defaultRecipients = teamSettings.defaultRecipients ?? [];

    const recipients: TEditorForm['recipients'] = defaultRecipients.map((recipient, index) => ({
      id: -(index + 1),
      formId: '',
      email: recipient.email,
      name: recipient.name,
      role: recipient.role,
      token: '',
      readStatus: 'NOT_OPENED' as ReadStatus,
      signingStatus: 'NOT_SIGNED' as SigningStatus,
      sendStatus: 'NOT_SENT' as SendStatus,
      signingOrder: index + 1,
      rejectionReason: null,
    }));

    return {
      id: '',
      title: 'New Form',
      status: 'DRAFT' as FormStatus,
      visibility: teamSettings.documentVisibility,
      externalId: embedAuthoringOptions?.externalId ?? null,
      folderId: embedAuthoringOptions?.folderId ?? null,
      userId: tokenUserId,
      teamId: tokenTeamId,
      recipients,
      fields: [],
      formMeta: {
        id: '',
        ...defaultMeta,
      },
      attachments: [],
    };
  }, []);

  return (
    <div className="relative min-h-screen min-w-screen">
      {isSubmitting && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-background">
          <Spinner />
          <p className="mt-2 text-muted-foreground text-sm">Submitting form...</p>
        </div>
      )}

      {submittedForm && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-background">
          <div className="mx-auto w-full max-w-md text-center">
            <CheckCircleIcon className="mx-auto h-16 w-16 text-primary" />
            <h1 className="mt-6 font-bold text-2xl">Form Submitted</h1>
            <p className="mt-2 text-muted-foreground">Your form has been submitted successfully.</p>
          </div>
        </div>
      )}

      <FormEditorProvider initialForm={initialForm} editorConfig={editorConfig}>
        <FormEditor />
      </FormEditorProvider>
    </div>
  );
};



// safe-value-pass-no-property-access: catch(err) only console.error('label:', err) and fixed toast; no unsafe property access
declare function createEnvelopeFromTemplate(templateId: string, recipients: string[]): Promise<{ id: string }>;
declare function showToast(msg: string, type: 'error' | 'success'): void;

async function handleEnvelopeCreate(templateId: string, recipients: string[]): Promise<string | null> {
  try {
    const envelope = await createEnvelopeFromTemplate(templateId, recipients);
    return envelope.id;
  } catch (err) {
    console.error('Failed to create envelope:', err);
    showToast('Failed to create envelope. Please try again.', 'error');
    return null;
  }
}
