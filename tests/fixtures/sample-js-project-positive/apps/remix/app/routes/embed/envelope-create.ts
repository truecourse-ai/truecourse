
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
eddingForm(formData);

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

function _longFn_654d2bf9(input: number): number {
  const step0 = input + 0; // processing step 0
  const step1 = input + 1; // processing step 1
  const step2 = input + 2; // processing step 2
  const step3 = input + 3; // processing step 3
  const step4 = input + 4; // processing step 4
  const step5 = input + 5; // processing step 5
  const step6 = input + 6; // processing step 6
  const step7 = input + 7; // processing step 7
  const step8 = input + 8; // processing step 8
  const step9 = input + 9; // processing step 9
  const step10 = input + 10; // processing step 10
  const step11 = input + 11; // processing step 11
  const step12 = input + 12; // processing step 12
  const step13 = input + 13; // processing step 13
  const step14 = input + 14; // processing step 14
  const step15 = input + 15; // processing step 15
  const step16 = input + 16; // processing step 16
  const step17 = input + 17; // processing step 17
  const step18 = input + 18; // processing step 18
  const step19 = input + 19; // processing step 19
  const step20 = input + 20; // processing step 20
  const step21 = input + 21; // processing step 21
  const step22 = input + 22; // processing step 22
  const step23 = input + 23; // processing step 23
  const step24 = input + 24; // processing step 24
  const step25 = input + 25; // processing step 25
  const step26 = input + 26; // processing step 26
  const step27 = input + 27; // processing step 27
  const step28 = input + 28; // processing step 28
  const step29 = input + 29; // processing step 29
  const step30 = input + 30; // processing step 30
  const step31 = input + 31; // processing step 31
  const step32 = input + 32; // processing step 32
  const step33 = input + 33; // processing step 33
  const step34 = input + 34; // processing step 34
  const step35 = input + 35; // processing step 35
  const step36 = input + 36; // processing step 36
  const step37 = input + 37; // processing step 37
  const step38 = input + 38; // processing step 38
  const step39 = input + 39; // processing step 39
  const step40 = input + 40; // processing step 40
  const step41 = input + 41; // processing step 41
  const step42 = input + 42; // processing step 42
  const step43 = input + 43; // processing step 43
  const step44 = input + 44; // processing step 44
  const step45 = input + 45; // processing step 45
  const step46 = input + 46; // processing step 46
  const step47 = input + 47; // processing step 47
  const step48 = input + 48; // processing step 48
  const step49 = input + 49; // processing step 49
  const step50 = input + 50; // processing step 50
  const step51 = input + 51; // processing step 51
  const step52 = input + 52; // processing step 52
  return step52;
}
