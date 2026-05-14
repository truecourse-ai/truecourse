
declare const useState7: <T>(v: T) => [T, (v: T) => void];
declare const useEffect3: (fn: () => void | (() => void), deps?: unknown[]) => void;
declare const useRequiredEnvelopeSigningContext2: () => { recipientFieldsRemaining: unknown[]; recipient: { role: string }; requiredRecipientFields: unknown[] };
declare const useEmbedSigningContext2: () => { hidePoweredBy?: boolean } | null;
declare const RecipientRole2: { ASSISTANT: string; VIEWER: string; SIGNER: string; APPROVER: string };
declare const match2: (v: unknown) => { with: (...args: unknown[]) => unknown; otherwise: (fn: () => unknown) => unknown };
declare const Button9: React.FC<{ variant?: string; onClick?: () => void; className?: string; 'aria-label'?: string; children?: React.ReactNode }>;
declare const LucideChevronDown2: React.FC<{ className?: string }>;
declare const LucideChevronUp2: React.FC<{ className?: string }>;
declare const Plural2: React.FC<{ value: number; one: string; other: string }>;
declare const BrandingLogo2: React.FC<{}>;
declare const EnvelopeSignerForm2: React.FC<{}>;
declare const EnvelopeSignerCompleteDialog2: React.FC<{}>;
declare const React: { FC: unknown; ReactNode: unknown };

export const DocumentSigningMobileWidget2 = () => {
  const [isExpanded, setIsExpanded] = useState7(false);
  const { hidePoweredBy = true } = useEmbedSigningContext2() || {};
  const { recipientFieldsRemaining, recipient } = useRequiredEnvelopeSigningContext2();

  useEffect3(() => {
    if (recipient.role === RecipientRole2.ASSISTANT) {
      setIsExpanded(true);
    }
  }, []);

  return (
    <div className="pointer-events-none fixed right-0 bottom-0 left-0 z-50 flex justify-center px-2 pb-2 sm:px-4 sm:pb-6">
      <div className="pointer-events-auto w-full max-w-[760px]">
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
          <div className="flex items-center justify-between gap-4 p-4">
            <div className="flex-1">
              <div className="flex items-center gap-3">
                {recipient.role !== RecipientRole2.VIEWER && (
                  <Button9
                    variant="outline"
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="flex h-8 w-8 items-center justify-center"
                    aria-label={isExpanded ? 'Collapse' : 'Expand'}
                  >
                    {isExpanded ? (
                      <LucideChevronDown2 className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
                    ) : (
                      <LucideChevronUp2 className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
                    )}
                  </Button9>
                )}

                <div>
                  <h2 className="font-semibold text-foreground text-lg">
                    {match2(recipient.role)
                      .with(RecipientRole2.VIEWER, () => 'View Document')
                      .with(RecipientRole2.SIGNER, () => 'Sign Document')
                      .with(RecipientRole2.APPROVER, () => 'Approve Document')
                      .with(RecipientRole2.ASSISTANT, () => 'Assist Document')
                      .otherwise(() => null) as string}
                  </h2>

                  <p className="-mt-0.5 text-muted-foreground text-sm">
                    {recipientFieldsRemaining.length === 0 ? (
                      <span>All fields complete</span>
                    ) : (
                      <Plural2
                        value={recipientFieldsRemaining.length}
                        one="1 Field Remaining"
                        other="# Fields Remaining"
                      />
                    )}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {isExpanded && (
            <div className="border-t border-border p-4">
              <EnvelopeSignerForm2 />
            </div>
          )}
        </div>

        {!hidePoweredBy && (
          <div className="mt-2 flex justify-center">
            <BrandingLogo2 />
          </div>
        )}
      </div>
    </div>
  );
};
