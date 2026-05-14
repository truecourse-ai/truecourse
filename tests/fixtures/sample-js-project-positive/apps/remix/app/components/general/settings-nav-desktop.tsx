
declare const useLocation2: () => { pathname: string };
declare const useSession5: () => { organisations: Array<{ currentOrganisationRole: string }> };
declare const isPersonalLayout2: (orgs: unknown[]) => boolean;
declare const canExecuteOrganisationAction2: (action: string, role: string) => boolean;
declare const IS_BILLING_ENABLED3: boolean;
declare const cn2: (...args: unknown[]) => string;
declare const Button8: React.FC<{ variant?: string; className?: string; children?: React.ReactNode }>;
declare const Link4: React.FC<{ to: string; className?: string; children?: React.ReactNode }>;
declare const UserIcon2: React.FC<{ className?: string }>;
declare const CreditCardIcon2: React.FC<{ className?: string }>;
declare const LockIcon2: React.FC<{ className?: string }>;
declare const WebhookIcon2: React.FC<{ className?: string }>;
declare const Globe2Icon2: React.FC<{ className?: string }>;
declare const Settings2Icon2: React.FC<{ className?: string }>;
declare const React: { FC: unknown; ReactNode: unknown };

export const SettingsDesktopNav2 = ({ className }: { className?: string }) => {
  const { pathname } = useLocation2();
  const { organisations } = useSession5();

  const isPersonalLayoutMode = isPersonalLayout2(organisations);

  const hasManageableBillingOrgs = organisations.some((org) =>
    canExecuteOrganisationAction2('MANAGE_BILLING', org.currentOrganisationRole),
  );

  return (
    <div className={cn2('flex flex-col gap-y-2', className)}>
      <Link4 to="/settings/profile">
        <Button8
          variant="ghost"
          className={cn2('w-full justify-start', pathname?.startsWith('/settings/profile') && 'bg-secondary')}
        >
          <UserIcon2 className="mr-2 h-5 w-5" />
          Profile
        </Button8>
      </Link4>

      {isPersonalLayoutMode && (
        <>
          <Link4 to="/settings/document">
            <Button8 variant="ghost" className={cn2('w-full justify-start')}>
              <Settings2Icon2 className="mr-2 h-5 w-5" />
              Preferences
            </Button8>
          </Link4>

          <Link4 className="w-full pl-8" to="/settings/document">
            <Button8
              variant="ghost"
              className={cn2('w-full justify-start', pathname?.startsWith('/settings/document') && 'bg-secondary')}
            >
              Document
            </Button8>
          </Link4>

          <Link4 className="w-full pl-8" to="/settings/branding">
            <Button8
              variant="ghost"
              className={cn2('w-full justify-start', pathname?.startsWith('/settings/branding') && 'bg-secondary')}
            >
              Branding
            </Button8>
          </Link4>

          <Link4 to="/settings/public-profile">
            <Button8
              variant="ghost"
              className={cn2('w-full justify-start', pathname?.startsWith('/settings/public-profile') && 'bg-secondary')}
            >
              <Globe2Icon2 className="mr-2 h-5 w-5" />
              Public Profile
            </Button8>
          </Link4>
        </>
      )}

      <Link4 to="/settings/security">
        <Button8
          variant="ghost"
          className={cn2('w-full justify-start', pathname?.startsWith('/settings/security') && 'bg-secondary')}
        >
          <LockIcon2 className="mr-2 h-5 w-5" />
          Security
        </Button8>
      </Link4>

      {IS_BILLING_ENABLED3 && hasManageableBillingOrgs && (
        <Link4 to="/settings/billing">
          <Button8
            variant="ghost"
            className={cn2('w-full justify-start', pathname?.startsWith('/settings/billing') && 'bg-secondary')}
          >
            <CreditCardIcon2 className="mr-2 h-5 w-5" />
            Billing
          </Button8>
        </Link4>
      )}

      <Link4 to="/settings/webhooks">
        <Button8
          variant="ghost"
          className={cn2('w-full justify-start', pathname?.startsWith('/settings/webhooks') && 'bg-secondary')}
        >
          <WebhookIcon2 className="mr-2 h-5 w-5" />
          Webhooks
        </Button8>
      </Link4>
    </div>
  );
};
