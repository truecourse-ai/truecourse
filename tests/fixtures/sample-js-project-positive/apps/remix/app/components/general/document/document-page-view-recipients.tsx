
declare const useLingui47: () => { _: (msg: unknown) => string; i18n: { date: (d: Date, opts?: unknown) => string } };
declare const useToast47: () => { toast: (opts: { title: string; description?: string; variant?: string; duration?: number }) => void };
declare const useSearchParams47: () => [URLSearchParams, (params: URLSearchParams | ((prev: URLSearchParams) => URLSearchParams)) => void];
declare const useEffect47: (fn: () => void | (() => void), deps: unknown[]) => void;
declare const useState47: <T>(init: T) => [T, (v: T) => void];
declare const Link47: React.ComponentType<{ to: string; className?: string; children: React.ReactNode }>;
declare const AvatarWithText47: React.ComponentType<{ name: string; email: string; avatarImageId?: string | null; className?: string }>;
declare const Badge47: React.ComponentType<{ variant?: string; className?: string; children: React.ReactNode }>;
declare const CopyTextButton47: React.ComponentType<{ value: string; className?: string }>;
declare const PopoverHover47: React.ComponentType<{ trigger: React.ReactNode; content: React.ReactNode }>;
declare const Tooltip47: React.ComponentType<{ children: React.ReactNode }>;
declare const TooltipContent47: React.ComponentType<{ children: React.ReactNode }>;
declare const TooltipTrigger47: React.ComponentType<{ asChild?: boolean; children: React.ReactNode }>;
declare const TooltipProvider47: React.ComponentType<{ children: React.ReactNode }>;
declare const TooltipArrow47: React.ComponentType;
declare const PlusIcon47: React.ComponentType<{ className?: string }>;
declare const MailIcon47: React.ComponentType<{ className?: string }>;
declare const MailOpenIcon47: React.ComponentType<{ className?: string }>;
declare const CheckIcon47: React.ComponentType<{ className?: string }>;
declare const Clock47: React.ComponentType<{ className?: string }>;
declare const UserIcon47: React.ComponentType<{ className?: string }>;
declare const PenIcon47: React.ComponentType<{ className?: string }>;
declare const AlertTriangle47: React.ComponentType<{ className?: string }>;
declare const SignatureIcon47: React.ComponentType<{ className?: string }>;
declare const DocumentStatus47: { COMPLETED: string; PENDING: string };
declare const RecipientRole47: { SIGNER: string; VIEWER: string; APPROVER: string; ASSISTANT: string };
declare const SigningStatus47: { SIGNED: string; REJECTED: string; NOT_SIGNED: string };
declare const msg47: (strings: TemplateStringsArray, ...vals: unknown[]) => unknown;
declare const match47: <T>(val: T) => { with: (...args: unknown[]) => { otherwise: (fn: () => unknown) => unknown } };
declare const RECIPIENT_ROLES_DESC47: Record<string, { label: string }>;
declare const isDocumentCompleted47: (doc: unknown) => boolean;
declare const formatSigningLink47: (recipient: unknown) => string;
declare const isRecipientExpired47: (recipient: unknown) => boolean;
declare const DateTime47: { DATETIME_SHORT: unknown };

type TEnvelope47 = {
  status: string;
  recipients: Array<{
    id: number;
    name: string;
    email: string;
    role: string;
    signingStatus: string;
    readStatus: string;
    sendStatus: string;
    token: string;
    fields: unknown[];
    signedAt?: Date | null;
    rejectedAt?: Date | null;
  }>;
};

type DocumentViewRecipientsProps47 = {
  envelope: TEnvelope47;
  documentRootPath: string;
};

export const DocumentViewRecipients47 = ({ envelope, documentRootPath }: DocumentViewRecipientsProps47) => {
  const { _, i18n } = useLingui47();
  const { toast } = useToast47();
  const [searchParams, setSearchParams] = useSearchParams47();
  const [highlightLinks, setHighlightLinks] = useState47(false);

  useEffect47(() => {
    if (searchParams.get('action') === 'copy-links') {
      setHighlightLinks(true);
      const params = new URLSearchParams(searchParams);
      params.delete('action');
      setSearchParams(params);
    }
  }, [searchParams, setSearchParams]);

  const recipients = envelope.recipients;

  return (
    <div className="space-y-3">
      {recipients.map((recipient) => {
        const signingLink = formatSigningLink47(recipient);
        const isExpired = isRecipientExpired47(recipient);
        const isSigned = recipient.signingStatus === SigningStatus47.SIGNED;
        const isRejected = recipient.signingStatus === SigningStatus47.REJECTED;

        return (
          <div key={recipient.id} className="flex items-center justify-between rounded-lg border p-3">
            <AvatarWithText47
              name={recipient.name}
              email={recipient.email}
              className="flex-1 min-w-0"
            />

            <div className="flex items-center gap-2 ml-2 flex-shrink-0">
              {isSigned && <Badge47 variant="success"><CheckIcon47 className="h-3 w-3" /></Badge47>}
              {isRejected && <Badge47 variant="destructive"><AlertTriangle47 className="h-3 w-3" /></Badge47>}
              {isExpired && !isSigned && !isRejected && (
                <TooltipProvider47>
                  <Tooltip47>
                    <TooltipTrigger47 asChild>
                      <Badge47 variant="warning"><Clock47 className="h-3 w-3" /></Badge47>
                    </TooltipTrigger47>
                    <TooltipContent47>Recipient link has expired</TooltipContent47>
                  </Tooltip47>
                </TooltipProvider47>
              )}

              {signingLink && !isDocumentCompleted47(envelope) && (
                <CopyTextButton47
                  value={signingLink}
                  className={highlightLinks ? 'ring-2 ring-blue-500' : ''}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};



declare const useLingui10: () => { _: (msg: unknown) => string };
declare const match5: (v: unknown) => { with: (pattern: unknown, fn: () => unknown) => unknown; exhaustive: () => unknown };
declare const RECIPIENT_ROLES_DESCRIPTION2: Record<string, { roleName: unknown }>;
declare const RecipientRole4: { APPROVER: string; CC: string; SIGNER: string; VIEWER: string; ASSISTANT: string };
declare const SigningStatus4: { SIGNED: string; NOT_SIGNED: string };
declare const DocumentStatus4: { DRAFT: string; COMPLETED: string };
declare const AvatarWithText3: React.FC<{ avatarFallback: string; primaryText: React.ReactNode; secondaryText: React.ReactNode }>;
declare const Badge5: React.FC<{ variant?: string; children?: React.ReactNode }>;
declare const CheckIcon2: React.FC<{ className?: string }>;
declare const MailIcon2: React.FC<{ className?: string }>;
declare const SignatureIcon2: React.FC<{ className?: string }>;
declare const MailOpenIcon2: React.FC<{ className?: string }>;
declare const UserIcon3: React.FC<{ className?: string }>;
declare const Clock8Icon2: React.FC<{ className?: string }>;
declare const isRecipientExpired2: (recipient: unknown) => boolean;
declare const Trans6: React.FC<{ children?: React.ReactNode }>;
declare const React: { FC: unknown; ReactNode: unknown };

type EnvelopeRecipient2 = {
  id: string;
  email: string;
  role: string;
  signingStatus: string;
  createdAt: Date;
  authOptions?: unknown;
};

export const DocumentPageViewRecipients2 = ({
  recipients,
  envelope,
}: {
  recipients: EnvelopeRecipient2[];
  envelope: { status: string };
}) => {
  const { _ } = useLingui10();

  return (
    <ul className="divide-y">
      {recipients.length === 0 && (
        <li className="flex flex-col items-center justify-center py-6 text-sm">
          <Trans6>No recipients</Trans6>
        </li>
      )}

      {recipients.map((recipient) => (
        <li key={recipient.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
          <AvatarWithText3
            avatarFallback={recipient.email.slice(0, 1).toUpperCase()}
            primaryText={<p className="text-muted-foreground text-sm">{recipient.email}</p>}
            secondaryText={
              <p className="text-muted-foreground/70 text-xs">
                {_(RECIPIENT_ROLES_DESCRIPTION2[recipient.role]?.roleName)}
              </p>
            }
          />

          <div className="flex flex-row items-center">
            {envelope.status !== DocumentStatus4.DRAFT && recipient.signingStatus === SigningStatus4.SIGNED && (
              <Badge5 variant="default">
                {match5(recipient.role)
                  .with(RecipientRole4.APPROVER, () => (
                    <>
                      <CheckIcon2 className="mr-1 h-3 w-3" />
                      <Trans6>Approved</Trans6>
                    </>
                  ))
                  .with(RecipientRole4.CC, () =>
                    envelope.status === DocumentStatus4.COMPLETED ? (
                      <>
                        <MailIcon2 className="mr-1 h-3 w-3" />
                        <Trans6>Sent</Trans6>
                      </>
                    ) : (
                      <>
                        <CheckIcon2 className="mr-1 h-3 w-3" />
                        <Trans6>Ready</Trans6>
                      </>
                    )
                  )
                  .with(RecipientRole4.SIGNER, () => (
                    <>
                      <SignatureIcon2 className="mr-1 h-3 w-3" />
                      <Trans6>Signed</Trans6>
                    </>
                  ))
                  .with(RecipientRole4.VIEWER, () => (
                    <>
                      <MailOpenIcon2 className="mr-1 h-3 w-3" />
                      <Trans6>Viewed</Trans6>
                    </>
                  ))
                  .with(RecipientRole4.ASSISTANT, () => (
                    <>
                      <UserIcon3 className="mr-1 h-3 w-3" />
                      <Trans6>Assisted</Trans6>
                    </>
                  ))
                  .exhaustive() as React.ReactNode}
              </Badge5>
            )}

            {envelope.status !== DocumentStatus4.DRAFT &&
              recipient.signingStatus === SigningStatus4.NOT_SIGNED &&
              isRecipientExpired2(recipient) && (
                <Badge5 variant="destructive">
                  <Clock8Icon2 className="mr-1 h-3 w-3" />
                  <Trans6>Expired</Trans6>
                </Badge5>
              )}
          </div>
        </li>
      ))}
    </ul>
  );
};
