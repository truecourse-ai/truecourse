
declare const useLingui6: () => { t: (msg: unknown) => string; i18n: unknown };
declare const useState8: <T>(v: T) => [T, (v: T) => void];
declare const match3: (v: unknown) => { with: (pattern: unknown, fn: () => unknown) => unknown; otherwise: (fn: () => unknown) => unknown };
declare const Badge4: React.FC<{ variant?: string; size?: string; children?: React.ReactNode }>;
declare const CardMetric2: React.FC<{ icon: React.FC; title: unknown; className?: string; children?: React.ReactNode }>;
declare const AdminLicenseResyncButton2: React.FC<{}>;
declare const Link6: React.FC<{ to: string; target?: string; className?: string; children?: React.ReactNode }>;
declare const KeyRoundIcon2: React.FC<{ className?: string }>;
declare const CheckCircle2Icon2: React.FC<{ className?: string }>;
declare const ArrowRightIcon2: React.FC<{ className?: string }>;
declare const Trans2: React.FC<{ context?: string; children?: React.ReactNode }>;
declare const React: { FC: unknown; ReactNode: unknown };

type TCachedLicense2 = {
  license?: {
    status: string;
    flags: Record<string, boolean>;
    expiresAt?: string;
    seats?: number;
  } | null;
  requestedLicenseKey?: string;
};

export const AdminLicenseCard2 = ({ licenseData }: { licenseData: TCachedLicense2 | null }) => {
  const { t } = useLingui6();
  const [isLicenseKeyVisible, setIsLicenseKeyVisible] = useState8(false);

  const { license } = licenseData || {};

  if (!license) {
    return (
      <div className="relative">
        <div className="absolute top-3 right-3 z-10">
          <AdminLicenseResyncButton2 />
        </div>
        <CardMetric2 icon={KeyRoundIcon2} title={t`License`} className="h-fit max-h-fit">
          <div className="mt-1 flex items-center justify-center gap-2">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-muted-foreground/30 border-dashed bg-muted/50">
              <KeyRoundIcon2 className="h-5 w-5 text-muted-foreground/50" />
            </div>

            <div className="flex flex-col gap-0.5">
              {licenseData?.requestedLicenseKey ? (
                <>
                  <p className="font-medium text-destructive text-sm">Invalid License Key</p>
                  <p className="text-muted-foreground text-xs">{licenseData.requestedLicenseKey}</p>
                </>
              ) : (
                <p className="font-medium text-muted-foreground text-sm">No License Configured</p>
              )}

              <Link6
                to="https://docs.example.com/licenses/enterprise"
                target="_blank"
                className="flex flex-row items-center text-muted-foreground text-xs hover:text-muted-foreground/80"
              >
                Learn more <ArrowRightIcon2 className="h-3 w-3" />
              </Link6>
            </div>
          </div>
        </CardMetric2>
      </div>
    );
  }

  const enabledFlags = Object.entries(license.flags).filter(([, enabled]) => enabled);

  return (
    <div className="relative max-w-full overflow-hidden rounded-lg border border-border bg-background px-4 pt-4 pb-6 shadow">
      <div className="absolute top-3 right-3">
        <AdminLicenseResyncButton2 />
      </div>

      <div className="flex items-start gap-2">
        <div className="h-4 w-4">
          <KeyRoundIcon2 className="h-4 w-4 text-muted-foreground" />
        </div>

        <h3 className="mb-2 flex items-end font-medium text-sm leading-tight">License</h3>

        {match3(license.status)
          .with('ACTIVE', () => (
            <Badge4 variant="default" size="small">
              <CheckCircle2Icon2 className="mr-1 h-3 w-3" />
              <Trans2 context="Subscription status">Active</Trans2>
            </Badge4>
          ))
          .otherwise(() => (
            <Badge4 variant="secondary" size="small">
              Inactive
            </Badge4>
          )) as React.ReactNode}
      </div>

      <div className="mt-4">
        <p className="text-sm text-muted-foreground">
          {enabledFlags.length} feature flag{enabledFlags.length !== 1 ? 's' : ''} enabled
        </p>

        {license.seats && (
          <p className="text-sm text-muted-foreground">Seats: {license.seats}</p>
        )}

        {license.expiresAt && (
          <p className="text-sm text-muted-foreground">Expires: {license.expiresAt}</p>
        )}
      </div>
    </div>
  );
};
