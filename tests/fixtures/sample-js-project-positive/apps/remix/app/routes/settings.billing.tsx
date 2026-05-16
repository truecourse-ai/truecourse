// --- unused-export shape: framework-convention-default-export (Remix route default export) ---
// The Remix framework imports the default export by convention at runtime —
// no explicit import statement appears in any source file, so the unused-export rule
// incorrectly flags this component as unused.

declare function useLoaderData<T>(): T;
declare function Link({ to, children }: { to: string; children: React.ReactNode }): JSX.Element;
declare namespace React { type ReactNode = unknown; }

type BillingInfo = {
  plan: string;
  renewalDate: string;
  seats: number;
};

function BillingSettingsPage(): JSX.Element {
  const { plan, renewalDate, seats } = useLoaderData<BillingInfo>();
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold">Billing</h1>
      <p>Plan: {plan}</p>
      <p>Renews: {renewalDate}</p>
      <p>Seats: {seats}</p>
      <Link to="/settings/billing/upgrade">Upgrade plan</Link>
    </div>
  );
}

export default BillingSettingsPage;



// Shape: array.map() constructing transformed member objects — standard transform, no type mismatch
declare const groupMembers: Array<{ id: string; userId: string; displayName: string; avatarUrl: string | null }>;

type MemberOption = {
  id: string;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
};

export function buildMemberOptions(): MemberOption[] {
  return groupMembers.map((member) => ({
    id: member.id,
    userId: member.userId,
    displayName: member.displayName,
    avatarUrl: member.avatarUrl,
  }));
}



// Shape: array.map() rendering JSX list items with feature.name — standard JSX list render, no type mismatch
declare const plan: { features: Array<{ name: string; included: boolean }>; name: string; price: number };

export function PlanFeatureListSnippet() {
  return (
    <div>
      <h3>{plan.name}</h3>
      {plan.features && plan.features.length > 0 && (
        <ul>
          {plan.features.map((feature, index) => (
            <li key={index}>{feature.name}</li>
          ))}
        </ul>
      )}
    </div>
  );
}


// FP shape: Remix route alias shim — settings.billing.tsx re-exports BillingSettingsPage
// from the org settings route. The name mismatch is structural/intentional in Remix.
export { TeamBillingSettingsPage as default } from '../o.$orgUrl.settings.billing';

