declare function useLoaderData<T>(): T;
declare function useState<T>(init: T | (() => T)): [T, (v: T | ((prev: T) => T)) => void];
declare function useMemo<T>(fn: () => T, deps: unknown[]): T;
declare function useLayoutEffect(fn: () => void, deps?: unknown[]): void;
declare function useTranslation(): { t: (key: string) => string };
declare function useNotification(): { show: (opts: { type: string; title: string; message: string }) => void };
declare function useTemplateUpdate(): { mutateAsync: (opts: unknown) => Promise<{ templateId: string }> };
declare const ZEmbedTemplateParamsSchema: { safeParse: (v: unknown) => { success: boolean; data: TTemplateEmbedParams } };
declare function decodeBase64Params(hash: string): unknown;
declare const DEFAULT_DATE_FORMAT: string;
declare const DEFAULT_TIMEZONE: string;

type TTemplateField = {
  id: number;
  nativeId?: number;
  formId: string;
  type: string;
  signerEmail: string;
  pageNumber: number;
  pageX: number;
  pageY: number;
  pageWidth: number;
  pageHeight: number;
  fieldMeta?: unknown;
};

type TTemplateSigner = {
  nativeId?: number;
  formId: string;
  name: string;
  email: string;
  role: string;
  signingOrder?: number;
  disabled: boolean;
};

type TTemplateConfig = {
  title: string;
  meta: {
    subject?: string;
    message?: string;
    timezone: string;
    dateFormat: string;
    redirectUrl?: string;
    signatureTypes: string[];
  };
  signers: TTemplateSigner[];
};

type TTemplateFieldsData = {
  fields: TTemplateField[];
};

type TTemplateEmbedParams = {
  features?: Record<string, boolean>;
  externalId?: string;
  onlyConfigureFields?: boolean;
};

export default function EmbedTemplateEditPage() {
  const { t } = useTranslation();
  const { show: showNotification } = useNotification();

  const { template, presignToken } = useLoaderData<{
    template: {
      id: number;
      title: string;
      fields: Array<{
        id: number;
        type: string;
        page: number;
        positionX: number;
        positionY: number;
        width: number;
        height: number;
        recipientId: number;
        fieldMeta?: unknown;
      }>;
      recipients: Array<{
        id: number;
        name: string;
        email: string;
        role: string;
        signingOrder?: number;
      }>;
      templateMeta?: {
        subject?: string;
        message?: string;
        timezone?: string;
        dateFormat?: string;
        redirectUrl?: string;
        drawSignatureEnabled?: boolean;
        typedSignatureEnabled?: boolean;
        uploadSignatureEnabled?: boolean;
      };
    };
    presignToken: string;
  }>();

  const [hasFinishedInit, setHasFinishedInit] = useState(false);

  const signatureTypes = useMemo(() => {
    const types: string[] = [];
    if (template.templateMeta?.drawSignatureEnabled) types.push('DRAW');
    if (template.templateMeta?.typedSignatureEnabled) types.push('TYPE');
    if (template.templateMeta?.uploadSignatureEnabled) types.push('UPLOAD');
    return types;
  }, [template.templateMeta]);

  const [configuration, setConfiguration] = useState<TTemplateConfig | null>(() => ({
    title: template.title,
    meta: {
      subject: template.templateMeta?.subject ?? undefined,
      message: template.templateMeta?.message ?? undefined,
      timezone: template.templateMeta?.timezone ?? DEFAULT_TIMEZONE,
      dateFormat: template.templateMeta?.dateFormat ?? DEFAULT_DATE_FORMAT,
      redirectUrl: template.templateMeta?.redirectUrl ?? undefined,
      signatureTypes,
    },
    signers: template.recipients.map((recipient) => ({
      nativeId: recipient.id,
      formId: `signer-${recipient.id}`,
      name: recipient.name,
      email: recipient.email,
      role: recipient.role,
      signingOrder: recipient.signingOrder ?? undefined,
      disabled: false,
    })),
  }));

  const [fields, setFields] = useState<TTemplateFieldsData | null>(() => ({
    fields: template.fields.map((field) => ({
      nativeId: field.id,
      formId: `field-${field.id}`,
      type: field.type,
      signerEmail: template.recipients.find((r) => r.id === field.recipientId)?.email ?? '',
      pageNumber: field.page,
      pageX: field.positionX,
      pageY: field.positionY,
      pageWidth: field.width,
      pageHeight: field.height,
      fieldMeta: field.fieldMeta ?? undefined,
    })),
  }));

  const [embedParams, setEmbedParams] = useState<TTemplateEmbedParams | null>(null);
  const [externalId, setExternalId] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState(1);
  const [canGoBack, setCanGoBack] = useState(true);

  const { mutateAsync: updateTemplate } = useTemplateUpdate();

  const handleConfigSubmit = (data: TTemplateConfig) => {
    setConfiguration(data);
    setFields((prev) => {
      if (!prev) return prev;
      const signerEmails = data.signers.map((s) => s.email);
      return { fields: prev.fields.filter((f) => signerEmails.includes(f.signerEmail)) };
    });
    setCurrentStep(2);
  };

  const handleBackToConfig = (data: TTemplateFieldsData) => {
    setFields(data);
    setCurrentStep(1);
  };

  const handleFieldsSubmit = async (data: TTemplateFieldsData) => {
    try {
      if (!configuration) {
        showNotification({ type: 'error', title: t('error'), message: t('please-configure-template-first') });
        return;
      }

      const fieldList = data.fields;
      const templateExternalId = externalId ?? undefined;

      const updateResult = await updateTemplate({
        templateId: template.id,
        title: configuration.title,
        externalId: templateExternalId,
        meta: {
          ...configuration.meta,
          drawSignatureEnabled:
            configuration.meta.signatureTypes.length === 0 ||
            configuration.meta.signatureTypes.includes('DRAW'),
          typedSignatureEnabled:
            configuration.meta.signatureTypes.length === 0 ||
            configuration.meta.signatureTypes.includes('TYPE'),
          uploadSignatureEnabled:
            configuration.meta.signatureTypes.length === 0 ||
            configuration.meta.signatureTypes.includes('UPLOAD'),
        },
        recipients: configuration.signers.map((signer) => ({
          id: signer.nativeId,
          name: signer.name,
          email: signer.email,
          role: signer.role,
          signingOrder: signer.signingOrder,
          fields: fieldList
            .filter((f) => f.signerEmail === signer.email)
            .map((f) => ({
              ...f,
              id: f.nativeId,
              pageX: f.pageX,
              pageY: f.pageY,
              width: f.pageWidth,
              height: f.pageHeight,
            })),
        })),
      });

      showNotification({ type: 'success', title: t('success'), message: t('template-updated-successfully') });

      if (window.parent !== window) {
        window.parent.postMessage(
          { type: 'template-updated', templateId: updateResult.templateId, externalId: templateExternalId },
          '*',
        );
      }
    } catch (err) {
      console.error('Error updating template:', err);
      showNotification({ type: 'error', title: t('error'), message: t('failed-to-update-template') });
    }
  };

  useLayoutEffect(() => {
    try {
      const hash = window.location.hash.slice(1);
      const parsed = ZEmbedTemplateParamsSchema.safeParse(decodeBase64Params(hash));

      if (!parsed.success) return;

      setEmbedParams(parsed.data);

      if (parsed.data.onlyConfigureFields) {
        setCurrentStep(2);
        setCanGoBack(false);
      }

      if (parsed.data.externalId) {
        setExternalId(parsed.data.externalId);
      }

      setHasFinishedInit(true);
    } catch (err) {
      console.error('Error parsing embed params:', err);
    }
  }, []);

  if (!hasFinishedInit) {
    return null;
  }

  return (
    <div className="relative mx-auto flex min-h-[100dvh] max-w-screen-lg p-6">
      <div className="template-embed-provider" data-features={JSON.stringify(embedParams?.features ?? {})}>
        <div className="stepper" data-step={currentStep}>
          <div className="step step-config">
            <div
              className="configure-template-view"
              data-values={JSON.stringify(configuration ?? {})}
              data-disable-upload="true"
              data-on-submit="handleConfigSubmit"
            />
          </div>
          <div className="step step-fields">
            <div
              className="configure-fields-view"
              data-config={JSON.stringify(configuration ?? {})}
              data-token={presignToken}
              data-values={JSON.stringify(fields ?? {})}
              data-on-back={canGoBack ? 'handleBackToConfig' : undefined}
              data-on-submit="handleFieldsSubmit"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
