// ContractSigningPageView — react-tsx FP shape
declare const useCurrentContractRender: () => { contractItems: unknown[]; currentItem: unknown; setCurrentItem: (v: unknown) => void };
declare const useRequiredContractSigningContext: () => {
  isDirectTemplate: boolean;
  contract: { id: number; type: string };
  signer: { id: number; role: string; name: string; email: string };
  signerFields: Array<{ id: number; type: string; inserted: boolean }>;
  signerFieldsRemaining: number;
  requiredSignerFields: unknown[];
  selectedHelperSignerFields: unknown[];
};
declare const useEmbedContractContext: () => { isEmbed?: boolean; allowRejection?: boolean; hidePoweredBy?: boolean; onRejected?: () => void } | null;
declare const useLingui_signing: () => { t: (s: TemplateStringsArray, ...args: unknown[]) => string };
declare const useMemo_signing: <T>(fn: () => T, deps: unknown[]) => T;
declare const useRef_signing: <T>(v: T | null) => { current: T | null };
declare const useState_signing: <T>(v: T) => [T, (v: T) => void];
declare const SignerRole: { VIEWER: string; SIGNER: string; APPROVER: string; HELPER: string };
declare const cn_signing: (...args: unknown[]) => string;

export const ContractSigningPageView = () => {
  const { contractItems, currentItem, setCurrentItem } = useCurrentContractRender();

  const scrollRef = useRef_signing<HTMLDivElement>(null);

  const {
    isDirectTemplate,
    contract,
    signer,
    signerFields,
    signerFieldsRemaining,
    requiredSignerFields,
    selectedHelperSignerFields,
  } = useRequiredContractSigningContext();

  const {
    isEmbed = false,
    allowRejection = true,
    hidePoweredBy = true,
    onRejected,
  } = useEmbedContractContext() || {};

  const { t } = useLingui_signing();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState_signing(false);

  const pendingFields = useMemo_signing(() => {
    if (signer.role === SignerRole.HELPER) {
      return selectedHelperSignerFields as Array<{ id: number; type: string; inserted: boolean }>;
    }
    return signerFields.filter((f) => !f.inserted);
  }, [signerFieldsRemaining, selectedHelperSignerFields, currentItem]);

  return (
    <div className="min-h-screen w-screen bg-gray-50 dark:bg-background">
      <div className="flex h-[calc(100vh-4rem)] w-screen">
        <div
          className={cn_signing(
            'hidden flex-shrink-0 flex-col border-r border-border bg-background transition-[width] duration-300 lg:flex',
            isSidebarCollapsed ? 'w-12' : 'w-80',
          )}
        >
          {isSidebarCollapsed ? (
            <div className="flex justify-center pt-4">
              <button
                aria-label={t`Expand sidebar`}
                onClick={() => setIsSidebarCollapsed(false)}
                className="flex h-7 w-7 items-center justify-center rounded hover:bg-muted"
              >
                <span className="h-4 w-4 text-muted-foreground">›</span>
              </button>
            </div>
          ) : (
            <div className="flex flex-1 flex-col overflow-hidden py-4">
              <div className="px-4">
                <div className="flex items-end justify-between">
                  <h3 className="text-sm font-semibold">
                    {signer.role === SignerRole.VIEWER ? t`View Contract` : t`Sign Contract`}
                  </h3>
                  <button
                    onClick={() => setIsSidebarCollapsed(true)}
                    className="flex h-7 w-7 items-center justify-center rounded hover:bg-muted"
                    aria-label={t`Collapse sidebar`}
                  >
                    <span className="h-4 w-4">‹</span>
                  </button>
                </div>

                <p className="mt-1 text-xs text-muted-foreground">
                  {signerFieldsRemaining === 0
                    ? t`All fields completed`
                    : `${signerFieldsRemaining} field(s) remaining`}
                </p>
              </div>

              <div className="mt-4 flex-1 overflow-y-auto px-2">
                {contractItems.length > 1 && (
                  <div className="mb-3 space-y-1">
                    {contractItems.map((item, idx) => (
                      <button
                        key={idx}
                        onClick={() => setCurrentItem(item)}
                        className={cn_signing(
                          'w-full rounded px-3 py-2 text-left text-xs',
                          item === currentItem ? 'bg-primary/10 font-medium' : 'hover:bg-muted',
                        )}
                      >
                        {t`Page`} {idx + 1}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="border-t border-border px-4 pt-3">
                {!isDirectTemplate && allowRejection && signer.role !== SignerRole.VIEWER && (
                  <button
                    onClick={onRejected}
                    className="w-full rounded border border-destructive px-3 py-2 text-xs text-destructive hover:bg-destructive/10"
                  >
                    {t`Decline to sign`}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="relative">{/* PDF viewer renders here */}</div>
        </div>
      </div>
    </div>
  );
};



// FP shape: React Router route file exporting a loader and React components — application route code,
// not a Node.js process entry point. Global error handlers belong at the server entry only.
declare function getSigningSessionByToken(token: string): Promise<{ id: string; documentId: string; recipientId: string; expiresAt: Date | null } | null>;
declare function json<T>(data: T, init?: { status: number }): Response;
declare function redirect(url: string): never;

export async function loader({ params }: { params: { token: string } }) {
  const session = await getSigningSessionByToken(params.token);
  if (!session) {
    throw redirect('/sign/expired');
  }
  if (session.expiresAt && session.expiresAt < new Date()) {
    return json({ error: 'expired' }, { status: 410 });
  }
  return json({ session });
}

export function SigningPage({ loaderData }: { loaderData: { session?: { id: string; documentId: string }; error?: string } }) {
  if (loaderData.error) {
    return loaderData.error;
  }
  return loaderData.session?.id ?? '';
}

export default SigningPage;
