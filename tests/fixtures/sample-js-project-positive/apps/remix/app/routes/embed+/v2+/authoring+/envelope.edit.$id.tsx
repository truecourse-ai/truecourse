
declare const useLayoutEffect6: (fn: () => void | (() => void), deps: unknown[]) => void;
declare const useMemo6: <T>(fn: () => T, deps: unknown[]) => T;
declare const useState6: <T>(init: T) => [T, (v: T) => void];
declare const useToast6: () => { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare const useLingui6: () => { t: (strings: TemplateStringsArray, ...vals: unknown[]) => string };
declare const trpc6: {
  embedding: {
    envelope: {
      update: {
        useMutation: (opts?: unknown) => { mutate: (data: unknown) => void; isPending: boolean };
      };
    };
  };
};
declare const TemplateEditor6: React.ComponentType<{ templateId: string; options: unknown; onSave: (data: unknown) => void; onError: (err: unknown) => void }>;
declare const TemplateEditorProvider6: React.ComponentType<{ templateId: string; children: React.ReactNode }>;
declare const TemplateEditorRendererWrapper6: React.ComponentType<{ children: React.ReactNode }>;
declare const CheckCircleIcon6: React.ComponentType<{ className?: string }>;
declare const Spinner6: React.ComponentType<{ className?: string }>;
declare const redirect6: (url: string) => never;
declare const superLoaderJson6: <T>(data: T) => T;
declare const useSuperLoaderData6: <T>() => T;
declare const injectCss6: (vars: Record<string, string>) => void;
declare const buildOptions6: (config: unknown) => unknown;

type EmbedTemplateEditLoaderData = {
  template: { id: string; title: string };
  options: unknown;
  token: string;
};

export async function embedTemplateEditLoader({ request, params }: { request: Request; params: { id?: string } }): Promise<EmbedTemplateEditLoaderData> {
  const { id } = params;

  if (!id || !id.startsWith('template_')) {
    throw redirect6('/embed/v2/authoring/error/not-found');
  }

  const url = new URL(request.url);
  const token = url.searchParams.get('token') || '';

  if (!token) {
    throw new Response('Invalid token', { status: 404 });
  }

  const template = { id, title: 'Sample Template' };
  const options = buildOptions6({ token, templateId: id });

  return superLoaderJson6({ template, options, token });
}

export function EmbedTemplateEditPage() {
  const loaderData = useSuperLoaderData6<EmbedTemplateEditLoaderData>();

  const { template, options } = loaderData;

  const { t } = useLingui6();
  const { toast } = useToast6();
  const [isSaved, setIsSaved] = useState6(false);

  const { mutate: updateTemplate, isPending: isUpdating } = trpc6.embedding.envelope.update.useMutation();

  useLayoutEffect6(() => {
    injectCss6({});
  }, []);

  const handleSave = (data: unknown) => {
    updateTemplate(data);
    setIsSaved(true);
  };

  const handleError = () => {
    toast({
      title: t`Failed to save template`,
      description: t`Please check the form and try again.`,
      variant: 'destructive',
    });
  };

  if (isSaved) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4">
        <CheckCircleIcon6 className="h-12 w-12 text-green-500" />
        <p className="text-lg font-medium">{t`Template saved successfully`}</p>
      </div>
    );
  }

  return (
    <TemplateEditorProvider6 templateId={template.id}>
      <TemplateEditorRendererWrapper6>
        {isUpdating && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/50">
            <Spinner6 className="h-8 w-8" />
          </div>
        )}

        <TemplateEditor6
          templateId={template.id}
          options={options}
          onSave={handleSave}
          onError={handleError}
        />
      </TemplateEditorRendererWrapper6>
    </TemplateEditorProvider6>
  );
}



// [unknown-catch-variable] catch(err) — console.error with label + err value; fixed toast follows
declare function updateEnvelopeSettings(opts: { envelopeId: string; settings: Record<string, unknown> }): Promise<void>;
declare const envelopeId: string;
declare const envelopeToast: (opts: { title: string; description: string; variant?: string }) => void;

async function handleEnvelopeSettingsUpdate(settings: Record<string, unknown>): Promise<void> {
  try {
    await updateEnvelopeSettings({ envelopeId, settings });
    envelopeToast({ title: 'Settings updated', description: 'Envelope settings have been saved.' });
  } catch (err) {
    console.error('Failed to update envelope settings:', err);
    envelopeToast({
      title: 'Update failed',
      description: 'We could not update the envelope settings. Please try again.',
      variant: 'destructive',
    });
  }
}
