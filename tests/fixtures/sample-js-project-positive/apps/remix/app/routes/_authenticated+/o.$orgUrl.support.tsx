declare function useState<T>(v: T): [T, (v: T) => void];
declare function SupportForm(props: any): any;

const HelpPage = () => {
  const [showForm, setShowForm] = useState(false);

  const handleSuccess = () => {
    setShowForm(false);
  };

  const handleCloseForm = () => {
    setShowForm(false);
  };

  return (
    <div>
      {showForm && (
        <SupportForm onSuccess={handleSuccess} onClose={handleCloseForm} />
      )}
    </div>
  );
};



declare function useCurrentOrg(): { name: string; url: string };

export default function OrganisationSupportPage() {
  const org = useCurrentOrg();

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold">Support — {org.name}</h1>
      <p className="mt-2 text-muted-foreground">
        Need help? Contact support or browse the documentation below.
      </p>
      <div className="mt-6 grid gap-4">
        <a
          href="https://docs.example.com"
          className="rounded-md border p-4 hover:bg-muted"
          target="_blank"
          rel="noreferrer"
        >
          Documentation
        </a>
        <a
          href="mailto:support@example.com"
          className="rounded-md border p-4 hover:bg-muted"
        >
          Email Support
        </a>
      </div>
    </div>
  );
}



declare const useCurrentOrganisation4: () => { id: number; subscription?: { status: string } | null };
declare const useSession3: () => { user: { id: number; email: string; name: string | null } };
declare const IS_BILLING_ENABLED2: boolean;
declare const Button7: React.FC<{ variant?: string; onClick?: () => void; children?: React.ReactNode }>;
declare const BookIcon2: React.FC<{ className?: string }>;
declare const HelpCircleIcon2: React.FC<{ className?: string }>;
declare const Link3: React.FC<{ to: string; children?: React.ReactNode; target?: string; rel?: string }>;
declare const SupportTicketForm2: React.FC<{ userId: number; email: string; name: string | null; onSuccess: () => void; onClose: () => void }>;
declare const appMetaTags3: (title: unknown) => unknown[];
declare const msg4: (strings: TemplateStringsArray) => unknown;
declare const useState4: <T>(v: T) => [T, (v: T) => void];
declare const useSearchParams3: () => [URLSearchParams, unknown];
declare const React: { FC: unknown; ReactNode: unknown };

export function orgSupportMeta() {
  return appMetaTags3(msg4`Support`);
}

export default function OrgSupportPage() {
  const [showForm, setShowForm] = useState4(false);
  const { user } = useSession3();
  const organisation = useCurrentOrganisation4();

  const [searchParams] = useSearchParams3();
  const teamId = searchParams.get('team');

  const subscriptionStatus = organisation.subscription?.status;

  const handleSuccess = () => { setShowForm(false); };
  const handleCloseForm = () => { setShowForm(false); };

  return (
    <div className="mx-auto w-full max-w-screen-xl px-4 md:px-8">
      <h1 className="text-2xl font-semibold">Support</h1>

      {!showForm ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex flex-col gap-2 rounded-lg border p-4">
            <BookIcon2 className="h-6 w-6" />
            <p className="font-medium">Documentation</p>
            <p className="text-sm text-muted-foreground">Browse our docs for guides and API reference.</p>
            <Link3 to="https://docs.example.com" target="_blank" rel="noopener noreferrer">
              Open docs
            </Link3>
          </div>

          <div className="flex flex-col gap-2 rounded-lg border p-4">
            <HelpCircleIcon2 className="h-6 w-6" />
            <p className="font-medium">Contact Support</p>
            <p className="text-sm text-muted-foreground">Submit a ticket and we'll get back to you.</p>
            <Button7 variant="default" onClick={() => setShowForm(true)}>
              Open ticket
            </Button7>
          </div>
        </div>
      ) : (
        <SupportTicketForm2
          userId={user.id}
          email={user.email}
          name={user.name}
          onSuccess={handleSuccess}
          onClose={handleCloseForm}
        />
      )}
    </div>
  );
}
