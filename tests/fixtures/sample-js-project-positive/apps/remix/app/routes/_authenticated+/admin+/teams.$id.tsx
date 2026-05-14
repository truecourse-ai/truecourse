declare function LicenseClient(): { getInstance: () => { getCachedLicense: () => Promise<{ license: { flags: Record<string, boolean> } }> } | null };
declare const useToast: () => { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare const useLingui: () => { i18n: unknown; t: (s: TemplateStringsArray, ...args: unknown[]) => string };
declare const useNavigate: () => (path: string) => void;
declare const useForm: <T>(opts: unknown) => { control: unknown; handleSubmit: (fn: (d: T) => Promise<void>) => (e: React.FormEvent) => void; formState: { isSubmitting: boolean }; reset: (v?: Partial<T>) => void };
declare const zodResolver: (s: unknown) => unknown;
declare const useMemo: <T>(fn: () => T, deps: unknown[]) => T;

declare namespace Route {
  interface ComponentProps { params: { id: string }; loaderData: { licenseFlags?: Record<string, boolean> } }
}

export async function adminTeamsLoader() {
  const licenseData = await LicenseClient().getInstance()?.getCachedLicense();
  return { licenseFlags: licenseData?.license?.flags };
}

export default function AdminTeamsDetailPage({ params, loaderData }: Route.ComponentProps) {
  const { licenseFlags } = loaderData;
  const { t } = useLingui();
  const { toast } = useToast();
  const navigate = useNavigate();
  const teamId = params.id;

  const form = useForm<{ name: string; url: string }>({
    resolver: zodResolver({}),
    defaultValues: { name: '', url: '' },
  });

  const featureFlags = useMemo(() => {
    if (!licenseFlags) return [];
    return Object.entries(licenseFlags)
      .filter(([, enabled]) => enabled)
      .map(([key]) => key);
  }, [licenseFlags]);

  const onSubmit = form.handleSubmit(async (data) => {
    try {
      toast({ title: t`Team updated` });
      navigate(`/admin/teams`);
    } catch {
      toast({ title: t`Failed to update team`, variant: 'destructive' });
    }
  });

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="font-bold text-2xl">{t`Team Details`}</h1>
        <p className="text-muted-foreground text-sm">{t`Manage team settings and members`}</p>
      </div>
      <div className="space-y-4 rounded-lg border border-border p-4">
        <h2 className="font-semibold">{t`General Settings`}</h2>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="font-medium text-sm">{t`Team name`}</label>
            <input type="text" className="input mt-1 w-full" />
          </div>
          <div>
            <label className="font-medium text-sm">{t`Team URL`}</label>
            <input type="text" className="input mt-1 w-full" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => navigate('/admin/teams')}>{t`Cancel`}</button>
            <button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? t`Saving...` : t`Save changes`}
            </button>
          </div>
        </form>
      </div>
      {featureFlags.length > 0 && (
        <div className="mt-4 rounded-lg border border-border p-4">
          <h2 className="mb-2 font-semibold">{t`Active License Features`}</h2>
          <ul className="list-inside list-disc space-y-1 text-sm">
            {featureFlags.map((flag) => <li key={flag}>{flag}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
