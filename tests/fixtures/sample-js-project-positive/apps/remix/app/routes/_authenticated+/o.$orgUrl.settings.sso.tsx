declare function toast(opts: { title: string }): void;
declare function CopyButton(props: any): any;
declare const loginUrl: string;
declare const callbackUrl: string;

const SsoCredentialsDisplay = () => {
  return (
    <div>
      <div className="relative">
        <input disabled value={loginUrl} />
        <CopyButton
          value={loginUrl}
          onCopySuccess={() => toast({ title: 'Copied to clipboard' })}
        />
      </div>
      <div className="relative">
        <input disabled value={callbackUrl} />
        <CopyButton
          value={callbackUrl}
          onCopySuccess={() => toast({ title: 'Copied to clipboard' })}
        />
      </div>
    </div>
  );
};



declare function useLoaderDataTyped2<T>(): T;
declare function useMutation2<T>(fn: (data: T) => Promise<void>): { mutate: (data: T) => void; isPending: boolean };

export default function OrganisationSSOSettingsPage() {
  const { ssoConfig, provider } = useLoaderDataTyped2<{
    ssoConfig: { enabled: boolean; entityId: string } | null;
    provider: string;
  }>();

  const { mutate, isPending } = useMutation2(async (data: { enabled: boolean }) => {
    await fetch('/api/sso/config', { method: 'POST', body: JSON.stringify(data) });
  });

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">SSO Configuration ({provider})</h2>
      <p className="text-sm text-muted-foreground">
        {ssoConfig?.enabled ? 'SSO is enabled' : 'SSO is disabled'}
      </p>
      <button
        className="btn btn-primary"
        disabled={isPending}
        onClick={() => mutate({ enabled: !ssoConfig?.enabled })}
      >
        {ssoConfig?.enabled ? 'Disable SSO' : 'Enable SSO'}
      </button>
    </div>
  );
}




declare function useCurrentWorkspace(): { id: string; currentRole: string };
declare function useWorkspaceBilling(): { data: { subscription: { status: string; cancelAtPeriodEnd: boolean; periodEnd: Date | null; productName?: string } | null; plans: Array<{ id: string; name: string; price: number }> } | null; isLoading: boolean };
declare function canManageWorkspaceBilling(action: string, role: string): boolean;
declare function WorkspaceBillingPortalButton(props: {}): any;
declare function BillingPlansGrid(props: { plans: Array<{ id: string; name: string; price: number }> }): any;
declare function WorkspaceBillingInvoicesTable(props: { workspaceId: string; hasSubscription: boolean }): any;
declare function formatDate(date: Date): string;
declare const Spinner: (props: { className?: string }) => any;

export default function WorkspaceSettingsBillingPage() {
  const workspace = useCurrentWorkspace();

  const { data: billingQuery, isLoading: isLoadingBilling } = useWorkspaceBilling();

  if (isLoadingBilling || !billingQuery) {
    return (
      <div className="flex items-center justify-center rounded-lg py-32">
        <Spinner className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const { subscription, plans } = billingQuery;

  const canManageBilling = canManageWorkspaceBilling('MANAGE_BILLING', workspace.currentRole);

  const { status, cancelAtPeriodEnd, periodEnd, productName } = subscription || {};

  const resolveSubscriptionMessage = () => {
    if (!subscription) {
      return <p className="text-sm">You are currently on the <span className="font-semibold">Free Plan</span>.</p>;
    }
    if (status === 'ACTIVE') {
      if (cancelAtPeriodEnd && periodEnd) {
        return productName ? (
          <p>
            You are subscribed to <span className="font-semibold">{productName}</span>{' '}
            which ends on <span className="font-semibold">{formatDate(periodEnd)}</span>.
          </p>
        ) : (
          <p>
            Your plan ends on <span className="font-semibold">{formatDate(periodEnd!)}</span>.
          </p>
        );
      }
      if (!cancelAtPeriodEnd && periodEnd) {
        return productName ? (
          <p>
            You are subscribed to <span className="font-semibold">{productName}</span>{' '}
            which renews on <span className="font-semibold">{formatDate(periodEnd)}</span>.
          </p>
        ) : (
          <p>
            Your plan renews on <span className="font-semibold">{formatDate(periodEnd!)}</span>.
          </p>
        );
      }
      return productName ? (
        <p>You are subscribed to <span className="font-semibold">{productName}</span>.</p>
      ) : (
        <p>You currently have an active plan.</p>
      );
    }
    if (status === 'INACTIVE') {
      return productName ? (
        <p>
          Your <span className="font-semibold">{productName}</span> subscription is inactive.
        </p>
      ) : (
        <p>Your current plan is inactive.</p>
      );
    }
    if (status === 'PAST_DUE') {
      return productName ? (
        <p>
          Your {productName} plan is past due. Please update your payment information.
        </p>
      ) : (
        <p>Your current plan is past due.</p>
      );
    }
    return null;
  };

  return (
    <div>
      <div className="flex flex-row items-end justify-between">
        <div>
          <h3 className="font-semibold text-2xl">Billing</h3>
          <div className="mt-2 text-muted-foreground text-sm">
            {resolveSubscriptionMessage()}
          </div>
        </div>
        <WorkspaceBillingPortalButton />
      </div>

      <hr className="my-4" />

      {(!subscription || subscription.status === 'INACTIVE') && canManageBilling && (
        <BillingPlansGrid plans={plans} />
      )}

      <section className="mt-6">
        <WorkspaceBillingInvoicesTable
          workspaceId={workspace.id}
          hasSubscription={Boolean(subscription)}
        />
      </section>
    </div>
  );
}



// FP shape: React Router route file that only exports a loader performing a redirect.
// This is application route code executed inside the framework's request lifecycle,
// not a Node.js process entry point. No process.on handler is needed here.
declare function requireOrgMember(request: Request, orgUrl: string): Promise<{ userId: string; orgId: string }>;
declare function redirect(url: string): never;

export async function loader({ request, params }: { request: Request; params: { orgUrl: string } }) {
  const { orgId } = await requireOrgMember(request, params.orgUrl);
  throw redirect(`/o/${params.orgUrl}/settings/sso/configure?orgId=${orgId}`);
}
