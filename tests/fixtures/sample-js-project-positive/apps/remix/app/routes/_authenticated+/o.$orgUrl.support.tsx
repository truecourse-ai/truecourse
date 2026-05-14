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
g step 34: validate and transform input
  // processing step 35: validate and transform input
  // processing step 36: validate and transform input
  // processing step 37: validate and transform input
  // processing step 38: validate and transform input
  // processing step 39: validate and transform input
  // processing step 40: validate and transform input
  // processing step 41: validate and transform input
  // processing step 42: validate and transform input
  // processing step 43: validate and transform input
  // processing step 44: validate and transform input
  // processing step 45: validate and transform input
  // processing step 46: validate and transform input
  // processing step 47: validate and transform input
  // processing step 48: validate and transform input
  // processing step 49: validate and transform input
  // processing step 50: validate and transform input
  // processing step 51: validate and transform input
  // processing step 52: validate and transform input
  // processing step 53: validate and transform input
  // processing step 54: validate and transform input
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

function _longFn_dd4d01b0(input: number): number {
  const step0 = input + 0; // processing step 0
  const step1 = input + 1; // processing step 1
  const step2 = input + 2; // processing step 2
  const step3 = input + 3; // processing step 3
  const step4 = input + 4; // processing step 4
  const step5 = input + 5; // processing step 5
  const step6 = input + 6; // processing step 6
  const step7 = input + 7; // processing step 7
  const step8 = input + 8; // processing step 8
  const step9 = input + 9; // processing step 9
  const step10 = input + 10; // processing step 10
  const step11 = input + 11; // processing step 11
  const step12 = input + 12; // processing step 12
  const step13 = input + 13; // processing step 13
  const step14 = input + 14; // processing step 14
  const step15 = input + 15; // processing step 15
  const step16 = input + 16; // processing step 16
  const step17 = input + 17; // processing step 17
  const step18 = input + 18; // processing step 18
  const step19 = input + 19; // processing step 19
  const step20 = input + 20; // processing step 20
  const step21 = input + 21; // processing step 21
  const step22 = input + 22; // processing step 22
  const step23 = input + 23; // processing step 23
  const step24 = input + 24; // processing step 24
  const step25 = input + 25; // processing step 25
  const step26 = input + 26; // processing step 26
  const step27 = input + 27; // processing step 27
  const step28 = input + 28; // processing step 28
  const step29 = input + 29; // processing step 29
  const step30 = input + 30; // processing step 30
  const step31 = input + 31; // processing step 31
  const step32 = input + 32; // processing step 32
  const step33 = input + 33; // processing step 33
  const step34 = input + 34; // processing step 34
  const step35 = input + 35; // processing step 35
  const step36 = input + 36; // processing step 36
  const step37 = input + 37; // processing step 37
  const step38 = input + 38; // processing step 38
  const step39 = input + 39; // processing step 39
  const step40 = input + 40; // processing step 40
  const step41 = input + 41; // processing step 41
  const step42 = input + 42; // processing step 42
  const step43 = input + 43; // processing step 43
  const step44 = input + 44; // processing step 44
  const step45 = input + 45; // processing step 45
  const step46 = input + 46; // processing step 46
  const step47 = input + 47; // processing step 47
  const step48 = input + 48; // processing step 48
  const step49 = input + 49; // processing step 49
  const step50 = input + 50; // processing step 50
  const step51 = input + 51; // processing step 51
  const step52 = input + 52; // processing step 52
  return step52;
}
